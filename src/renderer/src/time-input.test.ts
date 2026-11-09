import { expect, it } from "vitest";
import { durationText, parseDuration } from "./TimeInput";
it("round-trips minute and second durations", () => {
   for (const seconds of [5, 30, 59, 60, 74, 1800]) expect(parseDuration(durationText(seconds))).toBe(seconds);
});
it("reads durations the way people type them", () => {
   const cases: [string, number][] = [
      ["2", 120],
      ["1.5", 90],
      ["1,5", 90],
      [".5", 30],
      ["1:30", 90],
      ["1:5", 65],
      ["0:90", 90],
      ["2:", 120],
      [":45", 45],
      ["1:00:00", 3600],
      ["90s", 90],
      ["90 sec", 90],
      ["2 min", 120],
      ["2m", 120],
      ["1m30s", 90],
      ["1m 30", 90],
      ["1h 5m", 3900],
      [" 3 MINUTES ", 180],
   ];
   for (const [text, seconds] of cases) expect(parseDuration(text), text).toBe(seconds);
});
it("rejects text that is not a duration", () => {
   for (const text of ["", " ", "-1:30", "NaN", "abc", "5x", "1:2:3:4", "m", "30s 5", "999999999999999999:00"]) expect(parseDuration(text), text).toBeNull();
});
