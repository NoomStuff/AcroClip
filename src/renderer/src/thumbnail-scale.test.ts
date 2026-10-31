import { describe, expect, it } from "vitest";
import { gridZoomTarget } from "./thumbnail-scale";

describe("grid zoom steps", () => {
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
