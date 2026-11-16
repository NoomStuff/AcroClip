import { describe, expect, it } from "vitest";
import { libraryWorkers } from "./library-work";

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
