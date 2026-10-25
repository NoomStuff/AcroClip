import { describe, it, expect } from "vitest";
import { defaultPreferences } from "./defaults";
import { preferencesSchema } from "./validation";
import { bindingFor, normalizeBinding, shortcutConflict, eventBinding } from "./shortcuts";
describe("shortcut defaults and conflicts", () => {
   it("defaults to Alt+C for saving with no recording shortcut", () => {
      expect(bindingFor(defaultPreferences, "saveClip")).toBe("Alt+C");
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
      expect(normalizeBinding("CommandOrControl+Shift+E", false)).toBe(normalizeBinding("Ctrl+Shift+E", false));
   });
   it("uses physical letter and digit keys without changing native text modifiers", () => {
      expect(eventBinding({ code: "Digit2", key: "2", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent)).toBe("Control+2");
   });
});
