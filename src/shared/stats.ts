/**
 * Local usage history, kept so a stats page can answer questions the collection alone can't:
 * what got rewatched, how long saves take, how much capture time turns into clips.
 * Events only ever append. Clips are named by ID, never by path, so moving files changes nothing.
 */
export const statsVersion = 1;
/** Coarse replay map: how many times playback passed through each slice of a clip. */
export const watchedBuckets = 32;

/** How a save was asked for. */
export const saveTriggers = ["shortcut", "tray", "app", "command"] as const;
export type SaveTrigger = (typeof saveTriggers)[number];
/** Library and app actions worth counting. Clip-specific ones name the clip. */
export const statsActions = [
   "rename",
   "tag",
   "untag",
   "move",
   "reveal",
   "attacut",
   "trim",
   "folder-create",
   "folder-rename",
   "folder-move",
   "folder-delete",
   "tag-create",
   "tag-delete",
] as const;
export type StatsAction = (typeof statsActions)[number];

/** One file per month keeps appends small and lets old months be read or archived whole. */
export function statsFileName(at: number): string {
   const date = new Date(at);
   return `events-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}.jsonl`;
}
