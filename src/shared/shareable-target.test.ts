import { describe, expect, it } from "vitest";
import { shareableTargetAllowed } from "./shareable-target";

describe("shareable target availability", () => {
   it("compares the target in decimal MB with the clip bytes", () => {
      expect(shareableTargetAllowed(1_999_999, 2)).toBe(false);
      expect(shareableTargetAllowed(2_000_000, 2)).toBe(true);
      expect(shareableTargetAllowed(2_000_001, 2)).toBe(true);
   });
   it("does not offer exports before the file size is known", () => {
      expect(shareableTargetAllowed(0, 1)).toBe(false);
      expect(shareableTargetAllowed(Number.NaN, 1)).toBe(false);
      expect(shareableTargetAllowed(1_000_000, Number.POSITIVE_INFINITY)).toBe(false);
   });
});
