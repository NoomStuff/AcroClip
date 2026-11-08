import { describe, expect, it } from "vitest";
import { saveOutcomeMessage } from "./save-outcome";

describe("save outcome notices", () => {
   it("says what a save did", () => {
      expect(saveOutcomeMessage({ kind: "saved", previousFootage: false })).toBe("Clip saved");
      expect(saveOutcomeMessage({ kind: "saved", previousFootage: true })).toBe("Saved the footage that was still available");
      expect(saveOutcomeMessage({ kind: "extended", seconds: 101.6 })).toBe("Clip extended to 1:42");
      expect(saveOutcomeMessage({ kind: "kept-both" })).toBe("Couldn't extend the previous clip, saved normally");
   });
});
