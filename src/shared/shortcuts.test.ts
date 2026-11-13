import { describe, it, expect } from "vitest";
import { defaultPreferences } from "./defaults";
import { preferencesSchema } from "./validation";
import {
   bindingFor,
   normalizeBinding,
   shortcutConflict,
   shortcutClashes,
   eventBinding,
   physicalBinding,
   globalShortcutProblem,
   formatBinding,
} from "./shortcuts";
describe("shortcut defaults and conflicts", () => {
   it("defaults to Alt+C for saving with no recording shortcut", () => {
      expect(bindingFor(defaultPreferences, "saveClip")).toBe("Alt+C");
      expect(bindingFor(defaultPreferences, "newCategory")).toBe("CommandOrControl+N");
      expect(bindingFor(defaultPreferences, "newFolder")).toBe("CommandOrControl+Shift+N");
      for (const action of ["toggleRecording", "startRecording", "stopRecording"] as const) expect(bindingFor(defaultPreferences, action)).toBe("");
      expect(shortcutConflict(defaultPreferences, false)).toBeNull();
      expect(shortcutConflict(defaultPreferences, true)).toBeNull();
   });
   it("migrates old preferences without replacing the saved clip key", () => {
      const old = { ...defaultPreferences, collection: "/clips", shortcut: "Control+Shift+F9" };
      const saved = preferencesSchema.parse(old);
      expect(bindingFor(saved, "saveClip")).toBe(old.shortcut);
      expect(bindingFor(saved, "toggleRecording")).toBe("");
      expect(shortcutConflict(saved, false)).toBeNull();
   });
   it("retains explicitly saved recording shortcuts", () => {
      const saved = preferencesSchema.parse({ ...defaultPreferences, collection: "/clips", shortcuts: { toggleRecording: "Control+Shift+F9" } });
      expect(bindingFor(saved, "toggleRecording")).toBe("Control+Shift+F9");
   });
   it("detects alias conflicts but allows page-specific bindings on different pages", () => {
      const preferences = { ...defaultPreferences, shortcuts: { recording: "Ctrl+2" } };
      expect(shortcutConflict(preferences, false)).toMatch(/same shortcut/);
      expect(shortcutClashes(preferences, "recording", false)).toEqual(["Library page"]);
      expect(shortcutClashes(preferences, "library", false)).toEqual(["Capture page"]);
      expect(shortcutClashes(preferences, "settings", false)).toEqual([]);
      expect(normalizeBinding("CommandOrControl+Shift+E", false)).toBe(normalizeBinding("Ctrl+Shift+E", false));
   });
   it("uses physical letter and digit keys without changing native text modifiers", () => {
      expect(eventBinding({ code: "Digit2", key: "2", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Control+2");
      // AltGr layouts report Ctrl+Alt+Shift+T as Shift+T with AltGraph set.
      const altGraph = { code: "KeyT", key: "Þ", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true };
      expect(eventBinding({ ...altGraph, getModifierState: (key) => key === "AltGraph" })).toBe("Control+Alt+Shift+T");
      expect(eventBinding(altGraph, new Set(["Control", "Alt"]))).toBe("Control+Alt+Shift+T");
   });
   it("matches punctuation by position, so Ctrl+/ works where / needs Shift", () => {
      const german = { code: "Slash", key: "-", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
      expect(eventBinding(german as KeyboardEvent)).toBe("Control+-");
      expect(normalizeBinding(physicalBinding(german)!, false)).toBe(normalizeBinding(bindingFor(defaultPreferences, "shortcutHelp"), false));
      expect(physicalBinding({ code: "KeyA", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBeNull();
   });
   it("binds macro, numpad and media keys the way Electron registers them", () => {
      const press = (code: string, key: string, modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">> = {}) =>
         eventBinding({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });
      expect(press("F13", "F13")).toBe("F13");
      expect(press("F24", "F24", { ctrlKey: true })).toBe("Control+F24");
      // A numpad digit is its own key, apart from the digit row. With Num Lock off it acts as an arrow.
      expect(press("Numpad4", "4")).toBe("num4");
      expect(press("NumpadAdd", "+")).toBe("numadd");
      expect(press("Numpad4", "ArrowLeft")).toBe("Left");
      expect(press("Digit4", "4")).toBe("4");
      expect(press("AudioVolumeUp", "AudioVolumeUp")).toBe("VolumeUp");
      expect(press("MediaTrackNext", "MediaTrackNext")).toBe("MediaNextTrack");
      expect(press("ScrollLock", "ScrollLock")).toBe("Scrolllock");
      // Keys the browser can't name, such as unassigned macro keys, give no binding.
      expect(press("", "Unidentified")).toBe("");
      expect(formatBinding("Control+num4", false)).toBe("Ctrl + Num 4");
      expect(formatBinding("MediaPlayPause", false)).toBe("Play/Pause");
   });
   it("keeps global shortcuts from taking keys that type in every app", () => {
      for (const binding of ["4", "C", "Shift+4", "Space", "Left", "Enter"]) expect(globalShortcutProblem(binding)).toContain("block that key");
      for (const binding of ["Alt+C", "Control+4", "Command+Shift+F", "F13", "F8", "Shift+F9", "num4", "MediaPlayPause", "PrintScreen", ""])
         expect(globalShortcutProblem(binding)).toBeNull();
   });
});
