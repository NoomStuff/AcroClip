import { describe, expect, test } from "vitest";
import { sampleApplicationColor } from "./application-color";

const pixels = (...groups: [number, number, number, number, number][]) =>
   new Uint8ClampedArray(groups.flatMap(([r, g, b, a, count]) => Array.from({ length: count }, () => [r, g, b, a]).flat()));

describe("application icon accents", () => {
   test("neutral, transparent and nearly neutral icons keep the fallback", () => {
      expect(sampleApplicationColor(pixels([120, 120, 120, 255, 100]))).toBeNull();
      expect(sampleApplicationColor(pixels([255, 0, 0, 0, 100]))).toBeNull();
      expect(sampleApplicationColor(pixels([120, 120, 120, 255, 99], [255, 0, 0, 255, 1]))).toBeNull();
      expect(sampleApplicationColor(new Uint8ClampedArray())).toBeNull();
   });
   test("black borders and white highlights do not muddy the colored mark", () => {
      const sampled = sampleApplicationColor(pixels([0, 0, 0, 255, 40], [255, 255, 255, 255, 40], [255, 30, 0, 255, 20]));
      expect(sampled).toBe("hsl(7 72% 74%)");
   });
   test("nearby reds across the hue boundary stay red instead of averaging toward cyan", () => {
      const sampled = sampleApplicationColor(pixels([255, 0, 8, 255, 50], [255, 8, 0, 255, 50]));
      expect(sampled).toBe("hsl(0 72% 74%)");
   });
   test("the dominant colored area wins over a small contrasting mark", () => {
      expect(sampleApplicationColor(pixels([0, 90, 255, 255, 80], [255, 60, 0, 255, 20]))).toBe("hsl(219 72% 74%)");
   });
});
