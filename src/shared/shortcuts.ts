import type { Preferences } from "./types";
export const shortcutRegistry = [
   { id: "saveClip", label: "Save clip", scope: "global", page: "all", binding: "" },
   { id: "toggleRecording", label: "Start / stop capture", scope: "global", page: "all", binding: "" },
   { id: "startRecording", label: "Start capture", scope: "global", page: "all", binding: "" },
   { id: "stopRecording", label: "Stop capture", scope: "global", page: "all", binding: "" },
   { id: "recording", label: "Capture page", scope: "local", page: "all", binding: "CommandOrControl+1" },
   { id: "library", label: "Library page", scope: "local", page: "all", binding: "CommandOrControl+2" },
   { id: "viewer", label: "Player page", scope: "local", page: "all", binding: "CommandOrControl+3" },
   { id: "settings", label: "Settings page", scope: "local", page: "all", binding: "CommandOrControl+," },
   { id: "search", label: "Search clips", scope: "local", page: "library", binding: "CommandOrControl+F" },
   { id: "newCategory", label: "New tag", scope: "local", page: "all", group: "library", binding: "CommandOrControl+N" },
   { id: "newFolder", label: "New folder", scope: "local", page: "all", group: "library", binding: "CommandOrControl+Shift+N" },
   { id: "openClip", label: "Open first matching clip", scope: "local", page: "library", binding: "CommandOrControl+Enter" },
   { id: "copyClipFile", label: "Copy file", scope: "local", page: "library", binding: "CommandOrControl+C" },
   { id: "playPause", label: "Play / pause", scope: "local", page: "viewer", binding: "Space" },
   { id: "seekBack", label: "Seek back 5 seconds", scope: "local", page: "viewer", binding: "Left" },
   { id: "seekForward", label: "Seek forward 5 seconds", scope: "local", page: "viewer", binding: "Right" },
   { id: "mutePlayback", label: "Mute playback", scope: "local", page: "viewer", binding: "M" },
   { id: "fullscreen", label: "Fullscreen playback", scope: "local", page: "viewer", binding: "F" },
   { id: "createShareable", label: "Create shareable", scope: "local", page: "viewer", binding: "CommandOrControl+E" },
   { id: "showFile", label: "Show clip file", scope: "local", page: "viewer", binding: "CommandOrControl+Shift+O" },
   { id: "copyFile", label: "Copy file", scope: "local", page: "viewer", binding: "CommandOrControl+C" },
] as const;
export function shortcutGroup(item: (typeof shortcutRegistry)[number]) {
   return "group" in item ? item.group : item.page;
}
export type ShortcutAction = (typeof shortcutRegistry)[number]["id"];
export type ShortcutBindings = Partial<Record<ShortcutAction, string>>;
export function bindingFor(preferences: Pick<Preferences, "shortcut" | "shortcuts">, id: ShortcutAction): string {
   if (id === "saveClip") return preferences.shortcut;
   const explicit = preferences.shortcuts[id];
   if (explicit !== undefined) return explicit;
   return shortcutRegistry.find((item) => item.id === id)!.binding;
}
export function normalizeBinding(value: string, mac: boolean): string {
   return value
      .toLowerCase()
      .replace(/commandorcontrol|cmdorctrl/g, mac ? "command" : "control")
      .replace(/cmd|meta/g, "command")
      .replace(/ctrl/g, "control")
      .replace(/arrow/g, "")
      .replace(/return/g, "enter")
      .replace(/option/g, "alt")
      .split("+")
      .sort()
      .join("+");
}
type ShortcutDefinition = (typeof shortcutRegistry)[number];
function clashes(preferences: Pick<Preferences, "shortcut" | "shortcuts">, a: ShortcutDefinition, b: ShortcutDefinition, mac: boolean): boolean {
   const key = bindingFor(preferences, a.id);
   return (
      !!key &&
      normalizeBinding(key, mac) === normalizeBinding(bindingFor(preferences, b.id), mac) &&
      (a.page === "all" || b.page === "all" || a.page === b.page)
   );
}
export function shortcutConflict(preferences: Pick<Preferences, "shortcut" | "shortcuts">, mac: boolean): string | null {
   for (let i = 0; i < shortcutRegistry.length; i++)
      for (let j = i + 1; j < shortcutRegistry.length; j++) {
         const a = shortcutRegistry[i]!,
            b = shortcutRegistry[j]!;
         if (clashes(preferences, a, b, mac)) return `${a.label} and ${b.label} use the same shortcut.`;
      }
   return null;
}
/** The labels of other shortcuts that share this action's binding where both are active. */
export function shortcutClashes(preferences: Pick<Preferences, "shortcut" | "shortcuts">, id: ShortcutAction, mac: boolean): string[] {
   const item = shortcutRegistry.find((entry) => entry.id === id)!;
   return shortcutRegistry.filter((other) => other.id !== id && clashes(preferences, item, other, mac)).map((other) => other.label);
}
export type ShortcutModifier = "Control" | "Command" | "Alt" | "Shift";
type BindingEvent = Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { getModifierState?: (key: string) => boolean };
/**
 * The binding for a key press. On Windows, Ctrl+Alt is AltGr: when that types a character on the
 * current layout, the browser drops the Ctrl and Alt flags and reports AltGraph instead, so AltGraph
 * counts as both. `held` adds modifiers tracked from their own key presses, for flags the browser dropped.
 */
export function eventBinding(event: BindingEvent, held: ReadonlySet<ShortcutModifier> = new Set()): string {
   const altGraph = event.getModifierState?.("AltGraph") ?? false;
   const key = event.code.startsWith("Key")
      ? event.code.slice(3)
      : event.code.startsWith("Digit")
        ? event.code.slice(5)
        : event.key === " "
          ? "Space"
          : event.key.replace("Arrow", "");
   return [
      (event.ctrlKey || altGraph || held.has("Control")) && "Control",
      (event.metaKey || held.has("Command")) && "Command",
      (event.altKey || altGraph || held.has("Alt")) && "Alt",
      (event.shiftKey || held.has("Shift")) && "Shift",
      key,
   ]
      .filter(Boolean)
      .join("+");
}
export function formatBinding(value: string, mac: boolean): string {
   return value
      .replace(/CommandOrControl|CmdOrCtrl/g, mac ? "Cmd" : "Ctrl")
      .replace(/Control/g, "Ctrl")
      .replace(/Command/g, "Cmd")
      .replaceAll("+", " + ");
}
