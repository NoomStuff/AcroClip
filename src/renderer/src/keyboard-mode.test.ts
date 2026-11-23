import { describe, expect, it } from "vitest";
import { navigatesByKeyboard } from "./keyboard-mode";

const key = (value: string, modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">> = {}) => ({
   key: value,
   ctrlKey: false,
   metaKey: false,
   altKey: false,
   ...modifiers,
});
// Enough of an element for closest(): a text field or not.
const element = (text: boolean) => ({ closest: () => (text ? {} : null) }) as unknown as Element;

describe("keyboard navigation", () => {
   it("counts Tab, even from a text field", () => {
      expect(navigatesByKeyboard(key("Tab"), element(true), false)).toBe(true);
   });
   it("counts arrows and Enter that act on the focused control", () => {
      expect(navigatesByKeyboard(key("ArrowDown"), element(false), false)).toBe(true);
      expect(navigatesByKeyboard(key("Enter"), element(false), false)).toBe(true);
   });
   it("ignores the app's shortcuts, even on navigation keys", () => {
      expect(navigatesByKeyboard(key("ArrowLeft"), element(false), true)).toBe(false);
      expect(navigatesByKeyboard(key(" "), element(false), true)).toBe(false);
      expect(navigatesByKeyboard(key("c", { ctrlKey: true }), element(false), false)).toBe(false);
   });
   it("ignores letters and keys that only edit text", () => {
      expect(navigatesByKeyboard(key("m"), element(false), false)).toBe(false);
      expect(navigatesByKeyboard(key("ArrowLeft"), element(true), false)).toBe(false);
      expect(navigatesByKeyboard(key(" "), element(true), false)).toBe(false);
   });
});
