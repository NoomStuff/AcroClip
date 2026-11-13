import { describe, expect, it } from "vitest";
import { gridPlaces, gridRows, measuredSizes, rowOffsets, rowsInView } from "./grid-window";
import type { GridItemKind, GridSizes } from "./grid-window";

const sizes: GridSizes = { columns: 3, gap: 10, card: 100, placeholder: 120, header: 34, firstHeader: 20 };
const kinds = (text: string): GridItemKind[] => [...text].map((letter) => (letter === "h" ? "header" : letter === "p" ? "placeholder" : "card"));

describe("library grid window", () => {
   it("packs cards into rows and gives every header a row of its own", () => {
      expect(gridRows(kinds("cchcccch"), 3).map((row) => [row.start, row.end, row.header])).toEqual([
         [0, 2, false],
         [2, 3, true],
         [3, 6, false],
         [6, 7, false],
         [7, 8, true],
      ]);
      expect(gridRows(kinds("ccc"), 0)).toHaveLength(3);
   });
   it("places rows by what they hold", () => {
      const rows = gridRows(kinds("hccccpph"), 3);
      // A first header has no space above it. A row is as tall as its tallest item.
      expect(rowOffsets(rows, sizes)).toEqual([0, 30, 140, 270, 314]);
   });
   it("learns sizes from the rows on screen", () => {
      const rows = gridRows(kinds("hccccpphppp"), 3);
      // Mounted from the second row: cards, a mixed row, a header, then placeholders.
      expect(measuredSizes(sizes, rows, 1, [150, 170, 40, 160])).toEqual({ ...sizes, card: 150, header: 40, placeholder: 160 });
      expect(measuredSizes(sizes, rows, 0, [25])).toEqual({ ...sizes, firstHeader: 25 });
   });
   it("finds the rows in view, and always at least one", () => {
      const offsets = rowOffsets(gridRows(kinds("c".repeat(30)), 3), sizes);
      expect(rowsInView(offsets, 0, 250)).toEqual({ first: 0, end: 3 });
      expect(rowsInView(offsets, 115, 335)).toEqual({ first: 1, end: 4 });
      expect(rowsInView(offsets, -500, -100)).toEqual({ first: 0, end: 1 });
      expect(rowsInView(offsets, 5000, 9000)).toEqual({ first: 9, end: 10 });
      expect(rowsInView([0], 0, 100)).toEqual({ first: 0, end: 0 });
   });
   it("finds the slot of every item, mounted or not", () => {
      const rows = gridRows(kinds("hcccch"), 3);
      const keys = ["h1", "a", "b", "c", "d", "h2"];
      const place = gridPlaces((index) => keys[index]!, rows, rowOffsets(rows, sizes), [0, 110, 220]);
      expect(place("h1")).toEqual({ left: 0, top: 0 });
      expect(place("c")).toEqual({ left: 220, top: 30 });
      expect(place("d")).toEqual({ left: 0, top: 140 });
      expect(place("h2")).toEqual({ left: 0, top: 250 });
      expect(place("missing")).toBeUndefined();
   });
});
