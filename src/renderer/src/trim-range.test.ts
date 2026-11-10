import { describe, expect, it } from "vitest";
import { formatTrimTime, lastKeptTime, minimumTrimLength, moveTrimEdge, trimStep, trims } from "./trim-range";

describe("trim range", () => {
   it("keeps each edge inside the clip", () => {
      expect(moveTrimEdge({ start: 2, end: 8 }, "start", -3, 10, 0.1)).toEqual({ start: 0, end: 8 });
      expect(moveTrimEdge({ start: 2, end: 8 }, "end", 14, 10, 0.1)).toEqual({ start: 2, end: 10 });
   });
   it("never lets the handles cross or close the gap below the minimum", () => {
      expect(moveTrimEdge({ start: 2, end: 8 }, "start", 9, 10, 0.5)).toEqual({ start: 7.5, end: 8 });
      expect(moveTrimEdge({ start: 2, end: 8 }, "end", 1, 10, 0.5)).toEqual({ start: 2, end: 2.5 });
   });
   it("handles a clip shorter than the minimum", () => {
      expect(moveTrimEdge({ start: 0, end: 0.05 }, "start", 0.04, 0.05, 0.1)).toEqual({ start: 0, end: 0.05 });
   });
   it("needs two frames of slow clips and a tenth of a second otherwise", () => {
      expect(minimumTrimLength(60)).toBe(0.1);
      expect(minimumTrimLength(10)).toBe(0.2);
      expect(minimumTrimLength(undefined)).toBe(0.1);
   });
   it("steps one frame", () => {
      expect(trimStep(60)).toBeCloseTo(1 / 60);
      expect(trimStep(undefined)).toBeCloseTo(1 / 30);
   });
   it("treats handles within half a frame of the ends as untouched", () => {
      expect(trims({ start: 0, end: 10 }, 10, 60)).toBe(false);
      expect(trims({ start: 0.005, end: 9.995 }, 10, 60)).toBe(false);
      expect(trims({ start: 0.02, end: 10 }, 10, 60)).toBe(true);
      expect(trims({ start: 0, end: 9.9 }, 10, 60)).toBe(true);
   });
   it("shows the last kept frame at the end", () => {
      expect(lastKeptTime({ start: 2, end: 5 })).toBeCloseTo(4.999);
      expect(lastKeptTime({ start: 2, end: 2 })).toBe(2);
   });
   it("shows tenths without reading past the length", () => {
      expect(formatTrimTime(0)).toBe("0:00.0");
      expect(formatTrimTime(64.39)).toBe("1:04.3");
      expect(formatTrimTime(9.99)).toBe("0:09.9");
      expect(formatTrimTime(0.3)).toBe("0:00.3");
      expect(formatTrimTime(-1)).toBe("0:00.0");
   });
});
