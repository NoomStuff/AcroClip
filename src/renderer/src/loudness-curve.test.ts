import { describe, expect, it } from "vitest";
import { loudnessCurve } from "./loudness-curve";

const envelope = (length: number, peaks: number[], base = 0.45) =>
   Array.from({ length }, (_, index) => Math.max(base, ...peaks.map((peak) => 0.95 - Math.abs(index - peak) * 0.05)));

describe("loudnessCurve", () => {
   it("puts the loudest moment at the top and the quiet floor at the bottom", () => {
      const curve = loudnessCurve(envelope(240, [60, 180]))!;
      expect(Math.max(...curve.points)).toBeCloseTo(1, 1);
      expect(Math.min(...curve.points)).toBe(0);
      const peak = curve.points.indexOf(Math.max(...curve.points));
      expect([30, 90]).toContain(peak);
   });
   it("lifts peaks more than middling moments", () => {
      const curve = loudnessCurve(envelope(240, [120]))!;
      // A level halfway between floor and peak is drawn below half height.
      const half = curve.points.find((value) => value > 0.05 && value < 0.95)!;
      expect(half).toBeLessThan(0.95);
      expect(curve.points.filter((value) => value > 0.5).length).toBeLessThan(curve.points.filter((value) => value > 0.05).length);
   });
   it("hides flat audio instead of exaggerating noise", () => {
      expect(loudnessCurve(Array.from({ length: 240 }, (_, index) => 0.6 + (index % 3) * 0.02))).toBeNull();
      expect(loudnessCurve([])).toBeNull();
   });
   it("draws a closed path inside its box", () => {
      const { path, line } = loudnessCurve(envelope(240, [100]))!;
      expect(path.startsWith("M0 100")).toBe(true);
      expect(path.endsWith("L1000 100Z")).toBe(true);
      // The outline is the area's top edge, without the baseline.
      expect(path).toContain(line.slice(1));
      expect(line).not.toContain("Z");
   });
});
