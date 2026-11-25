import { describe, expect, it } from "vitest";
import { anyTitle, dailyLine, emptyTitles, noMatchTitle } from "./empty-flavor";

describe("empty state titles", () => {
   it("keeps one title for the whole day and can change the next", () => {
      const morning = new Date(2026, 10, 15, 8);
      expect(dailyLine(emptyTitles.library, "library", morning)).toBe(dailyLine(emptyTitles.library, "library", new Date(2026, 10, 15, 23)));
      const days = Array.from({ length: 30 }, (_, day) => dailyLine(emptyTitles.library, "library", new Date(2026, 10, day + 1)));
      expect(new Set(days).size).toBeGreaterThan(1);
   });

   it("quotes the search and matches every variant", () => {
      expect(noMatchTitle("ranked")).toContain('"ranked"');
      for (const title of emptyTitles.library) expect(anyTitle(emptyTitles.library).test(title)).toBe(true);
      expect(anyTitle(emptyTitles.library).test("No clips")).toBe(false);
   });
});

describe("noMatchTitle easter egg", () => {
   it("gives up on a word over 50 characters or more than 50 words", () => {
      expect(noMatchTitle("a".repeat(51))).toBe("bro stop");
      expect(noMatchTitle(`clip ${"a".repeat(50)}`)).not.toBe("bro stop");
      expect(noMatchTitle(Array.from({ length: 51 }, () => "clip").join(" "))).toBe("bro stop");
      expect(noMatchTitle(Array.from({ length: 50 }, () => "clip").join(" "))).not.toBe("bro stop");
   });
});
