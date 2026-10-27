import type { Preferences } from "./types";
export const shortcutRegistry = [
   { id: "saveClip", label: "Save clip", scope: "global", page: "all", binding: "" },
   { id: "toggleRecording", label: "Start / stop recording", scope: "global", page: "all", binding: "" },
   { id: "startRecording", label: "Start recording", scope: "global", page: "all", binding: "" },
   { id: "stopRecording", label: "Stop recording", scope: "global", page: "all", binding: "" },
   { id: "recording", label: "Recording page", scope: "local", page: "all", binding: "CommandOrControl+1" },
   { id: "library", label: "Library page", scope: "local", page: "all", binding: "CommandOrControl+2" },
   { id: "viewer", label: "Clip viewer", scope: "local", page: "all", binding: "CommandOrControl+3" },
   { id: "settings", label: "Settings", scope: "local", page: "all", binding: "CommandOrControl+," },
   { id: "search", label: "Search clips", scope: "local", page: "library", binding: "CommandOrControl+F" },
   { id: "newCategory", label: "New category", scope: "local", page: "library", binding: "CommandOrControl+Shift+N" },
   { id: "openClip", label: "Open first matching clip", scope: "local", page: "library", binding: "CommandOrControl+Enter" },
   { id: "playPause", label: "Play / pause", scope: "local", page: "viewer", binding: "Space" },
   { id: "seekBack", label: "Seek back 5 seconds", scope: "local", page: "viewer", binding: "Left" },
   { id: "seekForward", label: "Seek forward 5 seconds", scope: "local", page: "viewer", binding: "Right" },
   { id: "mutePlayback", label: "Mute playback", scope: "local", page: "viewer", binding: "M" },
   { id: "fullscreen", label: "Fullscreen playback", scope: "local", page: "viewer", binding: "F" },
   { id: "createShareable", label: "Create shareable", scope: "local", page: "viewer", binding: "CommandOrControl+E" },
   { id: "showFile", label: "Show clip file", scope: "local", page: "viewer", binding: "CommandOrControl+Shift+O" },
] as const;
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
export function shortcutConflict(preferences: Pick<Preferences, "shortcut" | "shortcuts">, mac: boolean): string | null {
   for (let i = 0; i < shortcutRegistry.length; i++)
      for (let j = i + 1; j < shortcutRegistry.length; j++) {
         const a = shortcutRegistry[i]!,
            b = shortcutRegistry[j]!,
            key = bindingFor(preferences, a.id);
         if (
            key &&
            normalizeBinding(key, mac) === normalizeBinding(bindingFor(preferences, b.id), mac) &&
            (a.page === "all" || b.page === "all" || a.page === b.page)
         )
            return `${a.label} and ${b.label} use the same shortcut.`;
      }
   return null;
}
export function eventBinding(event: KeyboardEvent): string {
   const key = event.code.startsWith("Key")
      ? event.code.slice(3)
      : event.code.startsWith("Digit")
        ? event.code.slice(5)
        : event.key === " "
          ? "Space"
          : event.key.replace("Arrow", "");
   return [event.ctrlKey && "Control", event.metaKey && "Command", event.altKey && "Alt", event.shiftKey && "Shift", key].filter(Boolean).join("+");
}
export function formatBinding(value: string, mac: boolean): string {
   return value
      .replace(/CommandOrControl|CmdOrCtrl/g, mac ? "Cmd" : "Ctrl")
      .replace(/Control/g, "Ctrl")
      .replace(/Command/g, "Cmd")
      .replaceAll("+", " + ");
}
