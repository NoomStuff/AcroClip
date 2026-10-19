import { describe, expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { applyRecordingPreset, fitRecordingSize, fitResolutionLimit } from "./recording-presets";
describe("recording presets", () => {
   it("caps High to source pixels and preserves ultrawide and portrait aspect ratios", () => {
      expect(applyRecordingPreset(defaultPreferences, "high", { width: 1920, height: 1080 })).toMatchObject({
         quality: "high",
         customWidth: 1920,
         customHeight: 1080,
         customFPS: 60,
         customCQ: 18,
         allowSoftwareEncoder: false,
      });
      expect(fitRecordingSize({ width: 2560, height: 1440 }, { width: 3840, height: 1080 })).toEqual({ width: 2560, height: 720 });
      expect(fitRecordingSize({ width: 2560, height: 1440 }, { width: 1080, height: 1920 })).toEqual({ width: 810, height: 1440 });
      expect(fitRecordingSize({ width: 1280, height: 720 }, { width: 641, height: 361 })).toEqual({ width: 640, height: 360 });
   });
   it("fills all controlled values without changing software encoder consent or Custom settings", () => {
      const input = { ...defaultPreferences, allowSoftwareEncoder: true, customCQ: 31, customFPS: 120 };
      expect(applyRecordingPreset(input, "low")).toMatchObject({
         customWidth: 1280,
         customHeight: 720,
         customFPS: 30,
         customCQ: 23,
         allowSoftwareEncoder: true,
      });
      expect(applyRecordingPreset(input, "custom")).toEqual({ ...input, quality: "custom" });
   });
});

describe("source-relative screen limits", () => {
   it("caps the short edge without shrinking ultrawide or portrait into a 16:9 box", () => {
      expect(fitResolutionLimit({ width: 3840, height: 1080 }, 1080)).toEqual({ width: 3840, height: 1080 });
      expect(fitResolutionLimit({ width: 5120, height: 2160 }, 1080)).toEqual({ width: 2560, height: 1080 });
      expect(fitResolutionLimit({ width: 2160, height: 3840 }, 1080)).toEqual({ width: 1080, height: 1920 });
      expect(fitResolutionLimit({ width: 641, height: 361 }, 1080)).toEqual({ width: 640, height: 360 });
      expect(fitResolutionLimit({ width: 2560, height: 1440 }, 720, true)).toEqual({ width: 2560, height: 1440 });
      expect(fitResolutionLimit({ width: 2560, height: 1440 }, 0)).toEqual({ width: 2560, height: 1440 });
   });
});
