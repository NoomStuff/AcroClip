import { describe, expect, it } from "vitest";
import { saveOutcomeNotice, savingNotice } from "./save-outcome";

describe("save outcome notices", () => {
   it("says up front when a save will extend the last clip", () => {
      expect(savingNotice()).toBe("Saving clip…");
      expect(savingNotice(150.4)).toBe("Extending clip to 2:30");
   });
   it("says what a save did", () => {
      expect(saveOutcomeNotice({ kind: "saved", previousFootage: false })).toEqual({ message: "Clip saved" });
      expect(saveOutcomeNotice({ kind: "saved", previousFootage: true })).toEqual({ message: "Saved the footage that was still available" });
   });
   it("gives the new length in the title and what was added in the detail", () => {
      expect(saveOutcomeNotice({ kind: "extended", seconds: 101.6, added: 41.6 })).toEqual({
         message: "Clip extended to 1:42",
         detail: "Added 0:42 to the previous clip",
      });
   });
   it("corrects an extension calmly, by saying what the library holds", () => {
      expect(saveOutcomeNotice({ kind: "kept-both" })).toEqual({
         message: "Saved as a separate clip",
         detail: "The previous clip couldn't be extended, so both are in your library.",
      });
      expect(saveOutcomeNotice({ kind: "extended-previous-kept" })).toMatchObject({ message: "Clip extended" });
   });
});
