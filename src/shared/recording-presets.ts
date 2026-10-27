import type { Preferences } from "./types";
export interface PixelSize {
   width: number;
   height: number;
}
const recordingPresets = {
   low: { resolutionLimit: 720, customWidth: 1280, customHeight: 720, customFPS: 30, customCQ: 23 },
   standard: { resolutionLimit: 1080, customWidth: 1920, customHeight: 1080, customFPS: 60, customCQ: 23 },
   high: { resolutionLimit: 0, customWidth: 2560, customHeight: 1440, customFPS: 60, customCQ: 18 },
} as const;
export function applyRecordingPreset(value: Preferences, quality: Preferences["quality"]): Preferences {
   return quality === "custom" ? { ...value, quality } : { ...value, ...recordingPresets[quality], recordingSizeVersion: 2, quality };
}

// p refers to the shorter edge, so landscape, ultrawide and portrait retain
// their proportions. Application capture always keeps its source pixels.
export function fitResolutionLimit(source: PixelSize, limit: number, application = false): PixelSize {
   if (source.width <= 0 || source.height <= 0) return { width: 0, height: 0 };
   const scale = application || limit === 0 ? 1 : Math.min(1, limit / Math.min(source.width, source.height));
   return { width: Math.floor((source.width * scale) / 2) * 2, height: Math.floor((source.height * scale) / 2) * 2 };
}
