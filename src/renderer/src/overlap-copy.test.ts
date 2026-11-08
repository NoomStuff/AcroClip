import { describe, expect, it } from "vitest";
import { overlapDetail } from "./overlap-copy";

describe("overlapping clip copy", () => {
   it("names the real clip length for merging", () => {
      expect(overlapDetail("merge", 60)).toBe("Saving again within 0:30 makes the previous clip longer.");
      expect(overlapDetail("merge", 20)).toBe("Saving again within 0:10 makes the previous clip longer.");
      expect(overlapDetail("merge", 300)).toBe("Saving again within 1:00 makes the previous clip longer.");
      expect(overlapDetail("trim", 60)).toContain("Leave out footage");
      expect(overlapDetail("keep", 60)).toContain("full length");
   });
});
