import { describe, it, expect } from "vitest";
import { defaultPreferences } from "./defaults";
import { preferencesSchema } from "./validation";
import { bindingFor, normalizeBinding, shortcutConflict, shortcutClashes, eventBinding, physicalBinding } from "./shortcuts";
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
});
