import { expect, it } from "vitest";
import { durationText, parseDuration } from "./TimeInput";
it("round-trips minute and second durations without accepting invalid seconds", () => {
   for (const seconds of [5, 30, 59, 60, 74, 1800]) expect(parseDuration(durationText(seconds))).toBe(seconds);
   for (const text of ["", "1:60", "-1:30", "1:2", "NaN", "999999999999999999:00"]) expect(parseDuration(text)).toBeNull();
});
