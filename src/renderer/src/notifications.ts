import { useEffect, useSyncExternalStore } from "react";

export type NotificationTone = "error" | "warning" | "info";

/** `toast` while it counts down in the bottom-right stack, `chip` once it lives in the status bar. */
export type NotificationPhase = "toast" | "chip";

export interface NotificationEntry {
   id: number;
   /** Conditions carry a key and leave on their own once the condition clears. */
   key: string | null;
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
   chip?: boolean;
}

interface NotificationState {
   entries: NotificationEntry[];
   /** A chipped entry reopened as a pinned toast. */
   open: number | null;
}

const MAX_ENTRIES = 20;

let state: NotificationState = { entries: [], open: null };
const listeners = new Set<() => void>();
let nextId = 1;
/** Conditions the user dismissed, by key, so the same message does not return. */
const dismissedConditions = new Map<string, string>();
/** The raw message each active condition was raised with. */
const conditionMessages = new Map<string, string>();

function commit(next: NotificationState) {
   state = next;
   for (const listener of listeners) listener();
}

/** First sentence as the title, the rest as expandable detail. */
export function splitMessage(message: string): { title: string; detail: string } {
   const text = message.trim();
   const match = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text);
   const title = (match ? match[1]! : text).replace(/(?<!\.)\.$/, "");
   return { title, detail: match ? match[2]!.trim() : "" };
}

function create(input: NotificationInput, key: string | null): NotificationEntry | null {
   const split = splitMessage(input.message);
   if (!split.title) return null;
   return {
      id: nextId++,
      key,
      title: split.title,
      detail: input.detail?.trim() || split.detail,
      tone: input.tone ?? "info",
      chip: key !== null || !!input.chip,
      createdAt: Date.now(),
      phase: "toast",
   };
}

const same = (a: NotificationEntry, b: NotificationEntry) => a.title === b.title && a.detail === b.detail;

export function notify(input: NotificationInput): void {
   const entry = create(input, null);
   if (!entry) return;
   // An active condition already says this; don't repeat it as a notification.
   if (state.entries.some((item) => item.key !== null && same(item, entry))) return;
   // A repeated message moves to the front instead of stacking a duplicate.
   const entries = [entry, ...state.entries.filter((item) => item.key !== null || !same(item, entry))].slice(0, MAX_ENTRIES);
   commit({ entries, open: entries.some((item) => item.id === state.open) ? state.open : null });
}

/** Show, update or clear a condition. It toasts once, then stays as a chip until cleared. */
export function setCondition(key: string, input: NotificationInput | null): void {
   const current = state.entries.find((item) => item.key === key);
   if (!input || !input.message.trim()) {
      dismissedConditions.delete(key);
      conditionMessages.delete(key);
      if (current) remove(current.id);
      return;
   }
   if (dismissedConditions.get(key) === input.message) return;
   dismissedConditions.delete(key);
   conditionMessages.set(key, input.message);
   const entry = create(input, key);
   if (!entry) return;
   if (current) {
      if (same(current, entry) && current.tone === entry.tone) return;
      // Updated wording keeps its place instead of toasting again.
      commit({ ...state, entries: state.entries.map((item) => (item.id === current.id ? { ...entry, id: current.id, phase: current.phase } : item)) });
      return;
   }
   // Drop plain notifications that this condition now covers.
   const entries = [entry, ...state.entries.filter((item) => item.key !== null || !same(item, entry))].slice(0, MAX_ENTRIES);
   commit({ ...state, entries });
}

export function useCondition(key: string, input: NotificationInput | null): void {
   const message = input?.message ?? "";
   const detail = input?.detail ?? "";
   const tone = input?.tone ?? "info";
   useEffect(() => {
      setCondition(key, message ? { message, detail, tone } : null);
   }, [key, message, detail, tone]);
   useEffect(() => () => setCondition(key, null), [key]);
}

function remove(id: number) {
   commit({ entries: state.entries.filter((item) => item.id !== id), open: state.open === id ? null : state.open });
}

/** The countdown ended. Chipped entries move into the status bar; the rest leave. */
export function expire(id: number): void {
   const entry = state.entries.find((item) => item.id === id);
   if (!entry || entry.phase !== "toast") return;
   if (!entry.chip) return remove(id);
   commit({ ...state, entries: state.entries.map((item) => (item.id === id ? { ...item, phase: "chip" } : item)) });
}

export function dismiss(id: number): void {
   const entry = state.entries.find((item) => item.id === id);
   if (entry?.key) dismissedConditions.set(entry.key, conditionMessages.get(entry.key) ?? "");
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
   commit({ entries: [], open: null });
}
