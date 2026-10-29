import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Preferences } from "../shared/types";
import { previewFilename, safeFileStem } from "../shared/filename";

export function recordingDestination(preferences: Preferences, source: string, now = new Date(), pendingPaths: readonly string[] = []): string {
   const label = safeFileStem(source);
   const folder = preferences.folderLayout === "application" ? join(preferences.collection, label) : preferences.collection;
   const filename = previewFilename(preferences, source, now);
   const pathKey = (path: string) => (process.platform === "linux" ? path : path.normalize("NFC").toLowerCase());
   const pendingNames = new Set(pendingPaths.map(pathKey));
   for (let number = 1; number <= 10000; number++) {
      const candidate = join(folder, number === 1 ? filename : `${filename.slice(0, -4)} (${number}).mkv`);
      if (!existsSync(candidate) && !existsSync(`${candidate}.saving.mkv`) && !pendingNames.has(pathKey(candidate))) return candidate;
   }
   throw new Error("Too many clips have this file name. Add date and time to your naming pattern.");
}
export function samePath(a: string, b: string): boolean {
   return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
export function isValidShortcut(value: string): boolean {
   const parts = value.split("+");
   const key = parts.pop() ?? "";
   const modifiers = new Set(["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "AltGr", "Shift", "Super", "Meta"]);
   if (parts.some((part) => !modifiers.has(part)) || new Set(parts).size !== parts.length) return false;
   return (
      /^[A-Z0-9]$/i.test(key) ||
      /^F(?:[1-9]|1\d|2[0-4])$/.test(key) ||
      new Set([
         "Plus",
         "Space",
         "Tab",
         "Capslock",
         "Numlock",
         "Scrolllock",
         "Backspace",
         "Delete",
         "Insert",
         "Return",
         "Enter",
         "Up",
         "Down",
         "Left",
         "Right",
         "Home",
         "End",
         "PageUp",
         "PageDown",
         "Escape",
         "Esc",
         "VolumeUp",
         "VolumeDown",
         "VolumeMute",
         "MediaNextTrack",
         "MediaPreviousTrack",
         "MediaStop",
         "MediaPlayPause",
         "PrintScreen",
         "-",
         "=",
         "[",
         "]",
         "\\",
         ";",
         "'",
         ",",
         ".",
         "/",
         "`",
      ]).has(key)
   );
}
export function recordingSourceLabel(preferences: Preferences, sources: Array<{ id: string; name: string }>): string {
   return sources.find((source) => source.id === preferences.sourceId)?.name ?? (preferences.sourceKind === "screen" ? "Screen" : "Application");
}
