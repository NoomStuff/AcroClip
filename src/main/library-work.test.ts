import { describe, expect, it } from "vitest";
import { libraryWorkers, shareableThreads } from "./library-work";

describe("libraryWorkers", () => {
   it("keeps to one worker while capturing or behind another app", () => {
      expect(libraryWorkers({ capturing: true, background: false, processors: 24 })).toBe(1);
      expect(libraryWorkers({ capturing: false, background: true, processors: 24 })).toBe(1);
   });
   it("uses half the processors when the machine is free, from 2 up to 8", () => {
      expect(libraryWorkers({ capturing: false, background: false, processors: 2 })).toBe(2);
      expect(libraryWorkers({ capturing: false, background: false, processors: 12 })).toBe(6);
      expect(libraryWorkers({ capturing: false, background: false, processors: 32 })).toBe(8);
   });
});

describe("shareableThreads", () => {
   it("fills the machine while AcroClip is in front, and keeps to a quarter behind another app", () => {
      expect(shareableThreads({ background: false, processors: 24 })).toBe(0);
      expect(shareableThreads({ background: true, processors: 24 })).toBe(6);
      expect(shareableThreads({ background: true, processors: 4 })).toBe(2);
   });
});
