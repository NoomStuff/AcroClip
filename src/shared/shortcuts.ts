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
   { id: "shortcutHelp", label: "Show shortcuts", scope: "local", page: "all", binding: "CommandOrControl+/" },
   { id: "search", label: "Search clips", scope: "local", page: "library", binding: "CommandOrControl+F" },
   { id: "newCategory", label: "New tag", scope: "local", page: "all", group: "library", binding: "CommandOrControl+N" },
   { id: "newFolder", label: "New folder", scope: "local", page: "all", group: "library", binding: "CommandOrControl+Shift+N" },
   { id: "openClip", label: "Open first matching clip", scope: "local", page: "library", binding: "CommandOrControl+Enter" },
   { id: "copyClipFile", label: "Copy file", scope: "local", page: "library", binding: "CommandOrControl+C" },
   { id: "playPause", label: "Play / pause", scope: "local", page: "viewer", binding: "Space" },
   { id: "seekBack", label: "Seek back 5 seconds", scope: "local", page: "viewer", binding: "Left" },
   { id: "seekForward", label: "Seek forward 5 seconds", scope: "local", page: "viewer", binding: "Right" },
   { id: "previousClip", label: "Previous clip", scope: "local", page: "viewer", binding: "PageUp" },
   { id: "nextClip", label: "Next clip", scope: "local", page: "viewer", binding: "PageDown" },
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
   const key = bindingKey(event);
   // Keys the browser can't name, such as unassigned macro keys, can't be registered.
   if (!key) return "";
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
// Numpad keys while Num Lock is on, named the way Electron registers them. With Num Lock off they
// act as arrows and Home or End, and bind by that key instead.
const numpadKeys: Record<string, string> = {
   Numpad0: "num0",
   Numpad1: "num1",
   Numpad2: "num2",
   Numpad3: "num3",
   Numpad4: "num4",
   Numpad5: "num5",
   Numpad6: "num6",
   Numpad7: "num7",
   Numpad8: "num8",
   Numpad9: "num9",
   NumpadDecimal: "numdec",
   NumpadAdd: "numadd",
   NumpadSubtract: "numsub",
   NumpadMultiply: "nummult",
   NumpadDivide: "numdiv",
};
// Browser key names that Electron spells differently.
const acceleratorKeys: Record<string, string> = {
   " ": "Space",
   "+": "Plus",
   AudioVolumeUp: "VolumeUp",
   AudioVolumeDown: "VolumeDown",
   AudioVolumeMute: "VolumeMute",
   MediaTrackNext: "MediaNextTrack",
   MediaTrackPrevious: "MediaPreviousTrack",
   ScrollLock: "Scrolllock",
   NumLock: "Numlock",
   CapsLock: "Capslock",
};
function bindingKey(event: Pick<KeyboardEvent, "code" | "key">): string {
   if (event.code.startsWith("Key")) return event.code.slice(3);
   if (event.code.startsWith("Digit")) return event.code.slice(5);
   const numpad = numpadKeys[event.code];
   if (numpad && /^[\d.,+\-*/]$/.test(event.key)) return numpad;
   if (!event.key || ["Unidentified", "Dead", "Process"].includes(event.key)) return "";
   return acceleratorKeys[event.key] ?? event.key.replace("Arrow", "");
}
const keyLabels: Record<string, string> = {
   numdec: "Num .",
   numadd: "Num +",
   numsub: "Num -",
   nummult: "Num *",
   numdiv: "Num /",
   volumeup: "Volume up",
   volumedown: "Volume down",
   volumemute: "Mute",
   medianexttrack: "Next track",
   mediaprevioustrack: "Previous track",
   mediastop: "Media stop",
   mediaplaypause: "Play/Pause",
   scrolllock: "Scroll Lock",
   numlock: "Num Lock",
   capslock: "Caps Lock",
   printscreen: "Print Screen",
   pageup: "Page Up",
   pagedown: "Page Down",
};
/** How one key of a binding reads to people, such as Num 4 for num4. */
export function keyLabel(key: string): string {
   const lower = key.toLowerCase();
   const digit = /^num(\d)$/.exec(lower);
   return digit ? `Num ${digit[1]}` : (keyLabels[lower] ?? key);
}
// Keys that neither type nor move the caret. Alone they make fine global shortcuts.
const standaloneKeys =
   /^(?:F(?:[1-9]|1\d|2[0-4])|num(?:\d|dec|add|sub|mult|div)|Insert|PrintScreen|Scrolllock|Volume(?:Up|Down|Mute)|Media(?:NextTrack|PreviousTrack|Stop|PlayPause))$/i;
/**
 * Why a global shortcut would get in the way, or null. A global shortcut takes its key from every
 * app, so a key that types or moves the caret needs Ctrl, Alt or the Windows key with it. Shift alone
 * still types, so it doesn't count.
 */
export function globalShortcutProblem(value: string): string | null {
   if (!value) return null;
   const parts = value.split("+");
   const key = parts.pop() ?? "";
   if (parts.some((part) => !/^shift$/i.test(part)) || standaloneKeys.test(key)) return null;
   return `${formatBinding(value, false)} alone would block that key in every app. Hold Ctrl or Alt with it, or use F13 to F24.`;
}
// US-layout symbols for punctuation keys, by physical position.
const physicalSymbols: Record<string, string> = {
   Slash: "/",
   Backslash: "\\",
   Comma: ",",
   Period: ".",
   Semicolon: ";",
   Quote: "'",
   BracketLeft: "[",
   BracketRight: "]",
   Minus: "-",
   Equal: "=",
   Backquote: "`",
};
/**
 * The binding for a punctuation key by its position on a US layout, or null for other keys.
 * On layouts where / needs Shift, the key in the US / position still opens Ctrl+/ shortcuts.
 */
export function physicalBinding(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
   const symbol = physicalSymbols[event.code];
   if (!symbol) return null;
   return [event.ctrlKey && "Control", event.metaKey && "Command", event.altKey && "Alt", event.shiftKey && "Shift", symbol].filter(Boolean).join("+");
}
export function formatBinding(value: string, mac: boolean): string {
   const parts = value.split("+");
   const key = parts.pop() ?? "";
   return [...parts, keyLabel(key)]
      .join("+")
      .replace(/CommandOrControl|CmdOrCtrl/g, mac ? "Cmd" : "Ctrl")
      .replace(/Control/g, "Ctrl")
      .replace(/Command/g, "Cmd")
      .replaceAll("+", " + ");
}
