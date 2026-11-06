import { useEffect, useSyncExternalStore } from "react";

/** Most severe first. The status bar orders and colors chips by this. */
export const notificationTones = ["error", "warning", "success"] as const;
export type NotificationTone = (typeof notificationTones)[number];

/** `toast` while it counts down in the bottom-right stack, `chip` once it lives in the status bar. */
export type NotificationPhase = "toast" | "chip";

export interface NotificationEntry {
   id: number;
   /** Set by the producer so it can replace or clear the entry later. */
   key: string | null;
   /** Conditions stay until the producer clears them, and toast only once. */
   condition: boolean;
   title: string;
   detail: string;
   tone: NotificationTone;
   /** Chipped entries stay in the status bar after the toast hides; the rest disappear. */
   chip: boolean;
   createdAt: number;
   phase: NotificationPhase;
}

export interface NotificationInput {
   message: string;
   detail?: string;
   tone?: NotificationTone;
   /** Keep the entry as a status-bar chip once its toast ends. */
   chip?: boolean;
   /** Skip the toast and land straight in the status bar, for messages already shown elsewhere. */
   toast?: boolean;
   /** A keyed notification replaces the previous one with the same key and can be cleared by it. */
   key?: string;
   /** Remove the chip after this long. Errors stay until dismissed unless this is set. */
   chipFor?: number;
}

interface NotificationState {
   entries: NotificationEntry[];
   /** A chipped entry reopened as a pinned toast. */
   open: number | null;
}

const MAX_ENTRIES = 20;
/** How long chips last when the producer gives no `chipFor`. */
const CHIP_LIFETIME: Record<NotificationTone, number | null> = { error: null, warning: 5 * 60_000, success: 30_000 };

let state: NotificationState = { entries: [], open: null };
const listeners = new Set<() => void>();
let nextId = 1;
/** Conditions the user dismissed, by key, so the same message does not return. */
const dismissedConditions = new Map<string, string>();
/** The raw message each active condition was raised with. */
const conditionMessages = new Map<string, string>();
/** Chip lifetimes, by entry id; they start once the entry becomes a chip. */
const lifetimes = new Map<number, number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function commit(next: NotificationState) {
   state = next;
   for (const listener of listeners) listener();
}

/** First sentence as the title, the rest as detail. */
export function splitMessage(message: string): { title: string; detail: string } {
   const text = message.trim();
   const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text);
   const title = (match ? match[1]! : text).replace(/(?<!\.)\.$/, "");
   return { title, detail: match ? match[2]!.trim() : "" };
}

function create(input: NotificationInput, condition: boolean): NotificationEntry | null {
   const split = splitMessage(input.message);
   if (!split.title) return null;
   const tone = input.tone ?? "success";
   const entry: NotificationEntry = {
      id: nextId++,
      key: input.key ?? null,
      condition,
      title: split.title,
      detail: input.detail?.trim() || split.detail,
      tone,
      chip: condition || !!input.chip || input.toast === false,
      createdAt: Date.now(),
      phase: input.toast === false ? "chip" : "toast",
   };
   const lifetime = condition ? null : (input.chipFor ?? CHIP_LIFETIME[tone]);
   if (lifetime !== null) lifetimes.set(entry.id, lifetime);
   return entry;
}

const same = (a: NotificationEntry, b: NotificationEntry) => a.title === b.title && a.detail === b.detail;

/** Starts or stops chip timers to match the entries. */
function schedule() {
   for (const [id, timer] of timers)
      if (!state.entries.some((entry) => entry.id === id && entry.phase === "chip")) {
         clearTimeout(timer);
         timers.delete(id);
      }
   for (const entry of state.entries) {
      const lifetime = lifetimes.get(entry.id);
      if (entry.phase !== "chip" || lifetime === undefined || timers.has(entry.id)) continue;
      timers.set(
         entry.id,
         setTimeout(() => expireChip(entry.id), lifetime)
      );
   }
   for (const id of lifetimes.keys()) if (!state.entries.some((entry) => entry.id === id)) lifetimes.delete(id);
}

function expireChip(id: number) {
   timers.delete(id);
   // An open message waits until it is closed.
   if (state.open === id) {
      timers.set(
         id,
         setTimeout(() => expireChip(id), 5_000)
      );
      return;
   }
   remove(id);
}

function update(entries: NotificationEntry[]) {
   const kept = entries.slice(0, MAX_ENTRIES);
   commit({ entries: kept, open: kept.some((item) => item.id === state.open) ? state.open : null });
   schedule();
}

export function notify(input: NotificationInput): void {
   const entry = create(input, false);
   if (!entry) return;
   // An active condition already says this; don't repeat it.
   if (state.entries.some((item) => item.condition && same(item, entry))) return;
   // A repeat, or a newer message under the same key, replaces the old one.
   update([entry, ...state.entries.filter((item) => item.condition || (entry.key ? item.key !== entry.key : !same(item, entry)))]);
}

/** Remove a keyed notification or condition once it no longer applies. */
export function clearNotification(key: string): void {
   const entries = state.entries.filter((item) => item.key !== key);
   if (entries.length !== state.entries.length) update(entries);
}

/** Show, update or clear a condition. It toasts once, then stays as a chip until cleared. */
export function setCondition(key: string, input: NotificationInput | null): void {
   const current = state.entries.find((item) => item.condition && item.key === key);
   if (!input || !input.message.trim()) {
      dismissedConditions.delete(key);
      conditionMessages.delete(key);
      if (current) remove(current.id);
      return;
   }
   if (dismissedConditions.get(key) === input.message) return;
   dismissedConditions.delete(key);
   conditionMessages.set(key, input.message);
   const entry = create({ ...input, key }, true);
   if (!entry) return;
   if (current) {
      if (same(current, entry) && current.tone === entry.tone) return;
      // Updated wording keeps its place instead of toasting again.
      update(state.entries.map((item) => (item.id === current.id ? { ...entry, id: current.id, phase: current.phase } : item)));
      return;
   }
   // Drop plain notifications that this condition now covers.
   update([entry, ...state.entries.filter((item) => item.condition || !same(item, entry))]);
}

export function useCondition(key: string, input: NotificationInput | null): void {
   const message = input?.message ?? "";
   const detail = input?.detail ?? "";
   const tone = input?.tone ?? "success";
   useEffect(() => {
      setCondition(key, message ? { message, detail, tone } : null);
   }, [key, message, detail, tone]);
   useEffect(() => () => setCondition(key, null), [key]);
}

function remove(id: number) {
   update(state.entries.filter((item) => item.id !== id));
}

/** The toast countdown ended. Chipped entries move into the status bar; the rest leave. */
export function expire(id: number): void {
   const entry = state.entries.find((item) => item.id === id);
   if (!entry || entry.phase !== "toast") return;
   if (!entry.chip) return remove(id);
   update(state.entries.map((item) => (item.id === id ? { ...item, phase: "chip" } : item)));
}

export function dismiss(id: number): void {
   const entry = state.entries.find((item) => item.id === id);
   if (entry?.condition && entry.key) dismissedConditions.set(entry.key, conditionMessages.get(entry.key) ?? "");
   remove(id);
}

export function clearAll(): void {
   for (const entry of state.entries) if (entry.phase === "chip") dismiss(entry.id);
}

/** Open a chipped entry as a pinned toast, or close it when it already is. */
export function toggleOpen(id: number): void {
   commit({ ...state, open: state.open === id ? null : id });
}

export function closeOpen(): void {
   if (state.open !== null) commit({ ...state, open: null });
}

/** Chips grouped by tone, most severe first, each group newest first. */
export function chipGroups(entries: NotificationEntry[]): { tone: NotificationTone; entries: NotificationEntry[] }[] {
   return notificationTones
      .map((tone) => ({ tone, entries: entries.filter((entry) => entry.chip && entry.phase === "chip" && entry.tone === tone) }))
      .filter((group) => group.entries.length > 0);
}

export function subscribe(listener: () => void): () => void {
   listeners.add(listener);
   return () => listeners.delete(listener);
}

export function getSnapshot(): NotificationState {
   return state;
}

export function useNotifications(): NotificationState {
   return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test hook: start from an empty store. */
export function resetNotifications(): void {
   dismissedConditions.clear();
   conditionMessages.clear();
   for (const timer of timers.values()) clearTimeout(timer);
   timers.clear();
   lifetimes.clear();
   commit({ entries: [], open: null });
}
