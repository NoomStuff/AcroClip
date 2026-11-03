import { describe, expect, it } from "vitest";
import { gridZoomRange, gridZoomTarget } from "./thumbnail-scale";

describe("grid zoom steps", () => {
   it("matches the range and position to the columns that fit after a resize", () => {
      expect(gridZoomRange(900, 18, 300)).toMatchObject({ min: 0, max: 1, value: 1, columns: 2, pixels: 441 });
      expect(gridZoomRange(1200, 18, 300)).toMatchObject({ min: 0, max: 3, value: 2, columns: 3, pixels: 388 });
      expect(gridZoomRange(180, 18, 300)).toMatchObject({ min: 0, max: 0, value: 0, columns: 1, pixels: 180 });
   });
   it("gives every slider step a distinct, achievable column count", () => {
      for (const width of [180, 699.5, 900.25, 1200, 1843.75]) {
         const range = gridZoomRange(width, 18, 300);
         const columns = range.sizes.map((size) => Math.max(1, Math.floor((width + 18) / (size + 18))));
         expect(new Set(columns).size).toBe(range.sizes.length);
         expect(columns).toEqual(Array.from({ length: range.sizes.length }, (_, index) => columns[0]! - index));
      }
   });
   it("jumps to adjacent column counts instead of fixed thumbnail increments", () => {
      expect(gridZoomTarget(1200, 18, 300, -1)).toBe(286);
      expect(gridZoomTarget(1200, 18, 300, 1)).toBe(440);
   });
   it("recalculates snap points for the viewport and gap", () => {
      expect(gridZoomTarget(900, 18, 300, -1)).toBe(288);
      expect(gridZoomTarget(900, 24, 300, -1)).toBe(284);
   });
   it("disables steps when no further column count is possible", () => {
      expect(gridZoomTarget(900, 18, 440, 1)).toBeNull();
      expect(gridZoomTarget(900, 18, 220, -1)).toBeNull();
      expect(gridZoomTarget(180, 18, 300, -1)).toBeNull();
      expect(gridZoomTarget(180, 18, 300, 1)).toBeNull();
      expect(gridZoomTarget(0, 18, 300, -1)).toBeNull();
   });
   it("changes exactly one column at each step across fractional viewport widths", () => {
      for (const width of [699.5, 900.25, 1200, 1843.75]) {
         for (const size of [220, 267, 300, 388, 440]) {
            for (const direction of [-1, 1] as const) {
               const target = gridZoomTarget(width, 18, size, direction);
               if (target === null) continue;
               expect(Math.max(1, Math.floor((width + 18) / (target + 18)))).toBe(Math.max(1, Math.floor((width + 18) / (size + 18))) - direction);
               expect(target).toBeGreaterThanOrEqual(220);
               expect(target).toBeLessThanOrEqual(440);
            }
         }
      }
   });
});
