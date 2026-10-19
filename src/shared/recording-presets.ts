import type { Preferences } from "./types";
export interface PixelSize {
   width: number;
   height: number;
}
export const recordingPresets = {
   low: { resolutionLimit: 720, customWidth: 1280, customHeight: 720, customFPS: 30, customCQ: 23 },
   standard: { resolutionLimit: 1080, customWidth: 1920, customHeight: 1080, customFPS: 60, customCQ: 23 },
   high: { resolutionLimit: 1440, customWidth: 2560, customHeight: 1440, customFPS: 60, customCQ: 18 },
} as const;
export function fitRecordingSize(requested: PixelSize, source?: PixelSize): PixelSize {
   if (!source || source.width <= 0 || source.height <= 0) return requested;
   const scale = Math.min(1, requested.width / source.width, requested.height / source.height);
   return { width: Math.floor((source.width * scale) / 2) * 2, height: Math.floor((source.height * scale) / 2) * 2 };
}
export function applyRecordingPreset(value: Preferences, quality: Preferences["quality"], source?: PixelSize): Preferences {
   if (quality === "custom") return { ...value, quality };
   const preset = recordingPresets[quality];
   const size = fitRecordingSize({ width: preset.customWidth, height: preset.customHeight }, source);
   return { ...value, ...preset, recordingSizeVersion: 2, quality, customWidth: size.width, customHeight: size.height };
}

// p refers to the shorter edge, so landscape, ultrawide and portrait retain
// their proportions. Application capture always keeps its source pixels.
export function fitResolutionLimit(source: PixelSize, limit: number, application = false): PixelSize {
   if (source.width <= 0 || source.height <= 0) return { width: 0, height: 0 };
   const scale = application || limit === 0 ? 1 : Math.min(1, limit / Math.min(source.width, source.height));
   return { width: Math.floor((source.width * scale) / 2) * 2, height: Math.floor((source.height * scale) / 2) * 2 };
}
