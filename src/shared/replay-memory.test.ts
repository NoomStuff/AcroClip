import { describe, expect, it as test } from "vitest";
import { automaticReplayMemoryMB, memoryLabel, replayCapacity, replayMemoryChoicesFor, resolveReplayMemoryMB } from "./replay-memory";

const GB = 2 ** 30;
describe("replay memory", () => {
   test("automatic uses an eighth of installed memory between 512 MB and 4 GB", () => {
      expect(automaticReplayMemoryMB(4 * GB)).toBe(512);
      expect(automaticReplayMemoryMB(8 * GB)).toBe(1024);
      // Windows reports slightly less than the installed 16 GB.
      expect(automaticReplayMemoryMB(15.73 * GB)).toBe(2048);
      expect(automaticReplayMemoryMB(24 * GB)).toBe(2048);
      expect(automaticReplayMemoryMB(32 * GB)).toBe(4096);
      expect(automaticReplayMemoryMB(128 * GB)).toBe(4096);
   });
   test("manual sizes stay within the recorder's bounds", () => {
      expect(resolveReplayMemoryMB(0, 16 * GB)).toBe(2048);
      expect(resolveReplayMemoryMB(1024, 16 * GB)).toBe(1024);
      expect(resolveReplayMemoryMB(64, 16 * GB)).toBe(256);
      expect(resolveReplayMemoryMB(99999, 16 * GB)).toBe(16384);
   });
   test("capacity mirrors the native bitrate ceiling", () => {
      const standard = replayCapacity(512, { width: 1920, height: 1080 }, 60, 1);
      // 0.85 of 512 MB, busy footage at 0.75 of 0.4 bits per pixel, and one
      // 160 kbps track: 97 s rounds to the nearest half minute. Fitting at the
      // floor rounds down from 240.8 s.
      expect(standard.fullQualitySeconds).toBe(90);
      expect(standard.fittingSeconds).toBe(240);
      const larger = replayCapacity(2048, { width: 1920, height: 1080 }, 60, 3);
      expect(larger.fullQualitySeconds).toBe(390);
      expect(larger.fittingSeconds).toBe(930);
      // Small canvases hit the bitrate floor first, so both lengths match.
      const low = replayCapacity(512, { width: 1280, height: 720 }, 30, 1);
      expect(low.fullQualitySeconds).toBe(low.fittingSeconds);
   });
   test("offers up to a quarter of installed memory", () => {
      expect(replayMemoryChoicesFor(8 * GB)).toEqual([512, 1024, 2048]);
      // 16 GB machines report about 15.7 GB and still get 4 GB.
      expect(replayMemoryChoicesFor(15.73 * GB)).toEqual([512, 1024, 2048, 4096]);
      expect(replayMemoryChoicesFor(32 * GB)).toEqual([512, 1024, 2048, 4096, 8192]);
   });
   test("labels memory in MB or GB", () => {
      expect(memoryLabel(512)).toBe("512 MB");
      expect(memoryLabel(2048)).toBe("2 GB");
      expect(memoryLabel(1536)).toBe("1.5 GB");
   });
});
