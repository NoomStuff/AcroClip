import { describe, expect, it } from "vitest";
import { footageWindow, mergeCandidate, mergeLimitSeconds } from "./merge-policy";
import type { SavedFootage } from "./merge-policy";

const options = { mode: "merge" as const, clipSeconds: 60, previousUntouched: true };
const clip = (clipId: string, requestedAt: number, duration = 60, session = "session"): SavedFootage => ({
   clipId,
   session,
   ...footageWindow(requestedAt, 0, duration),
});

describe("merging overlapping saves", () => {
   it("extends the previous clip when the next save soon follows, and predicts its length", () => {
      expect(mergeCandidate(clip("a", 100_000), clip("b", 120_000), options)).toEqual({ merge: true, seconds: 80, added: 20 });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 130_000), options)).toEqual({ merge: true, seconds: 90, added: 30 });
   });
   it("saves two moments further apart normally, even when their footage overlaps", () => {
      // Two highlights 55 s apart would otherwise become one clip with a dull middle.
      expect(mergeCandidate(clip("a", 100_000), clip("b", 155_000), options)).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 131_000), options)).toEqual({ merge: false });
      // Long clips extend within a minute, short ones within half their length.
      expect(mergeCandidate(clip("a", 100_000, 300), clip("b", 160_000, 300), { ...options, clipSeconds: 300 })).toEqual({
         merge: true,
         seconds: 360,
         added: 60,
      });
      expect(mergeCandidate(clip("a", 100_000, 300), clip("b", 161_000, 300), { ...options, clipSeconds: 300 })).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000, 20), clip("b", 111_000, 20), { ...options, clipSeconds: 20 })).toEqual({ merge: false });
   });
   it("keeps clips apart when their footage does not overlap", () => {
      expect(mergeCandidate(clip("a", 100_000), clip("b", 160_000), options)).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 175_000), options)).toEqual({ merge: false });
   });
   it("never merges across capture sessions, after use, or outside merge mode", () => {
      expect(mergeCandidate(clip("a", 100_000), clip("b", 120_000, 60, "other"), options)).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 120_000), { ...options, previousUntouched: false })).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 120_000), { ...options, mode: "keep" })).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000), clip("b", 120_000), { ...options, mode: "trim" })).toEqual({ merge: false });
      expect(mergeCandidate(undefined, clip("b", 120_000), options)).toEqual({ merge: false });
      expect(mergeCandidate(clip("a", 100_000, 60, ""), clip("b", 120_000, 60, ""), options)).toEqual({ merge: false });
   });
   it("stops a chain of saves at the length limit", () => {
      expect(mergeLimitSeconds(60)).toBe(300);
      expect(mergeLimitSeconds(300)).toBe(600);
      const chained: SavedFootage = { clipId: "merged", session: "session", start: 0, end: 290_000 };
      expect(mergeCandidate(chained, clip("c", 300_000), options)).toEqual({ merge: true, seconds: 300, added: 10 });
      expect(mergeCandidate({ ...chained, start: -1_000 }, clip("c", 300_000), options)).toEqual({ merge: false });
   });
   it("accounts for footage that ended before the save request", () => {
      expect(footageWindow(10_000, 0.5, 4)).toEqual({ start: 5_500, end: 9_500 });
   });
});
