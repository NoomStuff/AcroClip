import { describe, expect, it } from "vitest";
import { advanceMeter, gainDb, gainText, parseGain } from "./audio-meter";
describe("mixer gain and meter timing", () => {
   it("keeps stored linear gain while displaying signed decibels and silence", () => {
      expect(gainText(1)).toBe("0.0");
      expect(gainText(2)).toBe("+6.0");
      expect(gainText(0)).toBe("-inf");
      expect(parseGain("-6.0206")).toBe(0.5);
      expect(parseGain("+6.0206")).toBe(2);
      expect(parseGain("-inf")).toBe(0);
      expect(parseGain("bad")).toBeNull();
      expect(parseGain("+12")).toBe(3.98);
      expect(parseGain("+30")).toBe(3.98);
      for (let step = 1; step <= 398; step++) expect(parseGain(gainDb(step / 100).toFixed(8))).toBe(step / 100);
   });
   it("rises immediately, holds a peak, and releases using elapsed dB time", () => {
      const initial = { level: 0, peak: 0, holdUntil: 0, clipUntil: 0 };
      const onset = advanceMeter(initial, 80, 0, 16);
      expect(onset.level).toBe(80);
      expect(onset.peak).toBe(80);
      const decay = advanceMeter(onset, 0, 1000, 1000);
      expect(decay.level).toBe(40);
      expect(decay.peak).toBe(80);
      const released = advanceMeter(decay, 0, 2000, 1000);
      expect(released.level).toBe(0);
      expect(released.peak).toBe(70);
      const clipped = advanceMeter(initial, 100, 100, 16);
      expect(clipped.clipUntil).toBe(1600);
      expect(advanceMeter(clipped, 0, 1700, 1600).clipUntil).toBeLessThan(1700);
   });
});
