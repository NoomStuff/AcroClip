import { useSyncExternalStore } from "react";

export interface NotificationEntry {
   id: number;
   message: string;
   error: boolean;
   /** Chipped notifications stay in the status bar after the toast hides. */
   chip: boolean;
   createdAt: number;
   /** While true the entry shows as the toast; afterwards it lives as a chip. */
   toasted: boolean;
}

interface NotificationState {
   entries: NotificationEntry[];
   /** Entry currently pinned open in a toast, usually reopened from its chip. */
   openId: number | null;
}

const MAX_ENTRIES = 20;

let state: NotificationState = { entries: [], openId: null };
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
   for (const listener of listeners) listener();
}

function replaceEntry(id: number, update: Partial<NotificationEntry>) {
   state = { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...update } : entry)) };
   emit();
}

export function notify(input: { message: string; error?: boolean; chip?: boolean }): void {
   const message = input.message.trim();
   if (!message) return;
   const entry: NotificationEntry = {
      id: nextId++,
      message,
      error: !!input.error,
      chip: !!input.chip,
      createdAt: Date.now(),
      toasted: true,
   };
   // A repeated message moves to the top instead of stacking a duplicate.
   const entries = [entry, ...state.entries.filter((item) => item.message !== message)].slice(0, MAX_ENTRIES);
   state = { entries, openId: null };
   emit();
}

/** The toast countdown ended: chipped entries collapse into the bar, the rest are gone. */
export function expire(id: number): void {
   const entry = state.entries.find((item) => item.id === id);
   if (!entry || !entry.toasted) return;
   if (entry.chip) replaceEntry(id, { toasted: false });
   else {
      state = { entries: state.entries.filter((item) => item.id !== id), openId: state.openId === id ? null : state.openId };
      emit();
   }
}

export function dismiss(id: number): void {
   state = { entries: state.entries.filter((item) => item.id !== id), openId: state.openId === id ? null : state.openId };
   emit();
}

export function clearAll(): void {
   state = { entries: state.entries.filter((item) => item.toasted), openId: null };
   emit();
}

/** Reopen (or close) a chipped notification as a pinned toast. */
export function setToastOpen(id: number | null): void {
   if (state.openId === id) return;
   state = { ...state, openId: id };
   emit();
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
