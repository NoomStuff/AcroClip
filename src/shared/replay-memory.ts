import type { PixelSize } from "./recording-presets";

// Keep these in step with historyByteLimit and bitrateCeilingKbps in
// native/recorder.cpp.
export const replayMemoryBounds = { min: 256, max: 16384 } as const;
export const replayMemoryChoices = [512, 1024, 2048, 4096, 8192] as const;
const historyShare = 0.85;
const audioTrackKbps = 160;
const floorKbps = 15000;
const ceilingKbps = 100000;
const kbpsPerPixel = 0.4;
// The busiest realistic test footage (fast motion at CQ 23) wanted about 0.75
// of the pixel ceiling. Only per-frame grain reached the ceiling itself.
const busyShare = 0.75;

// Automatic uses an eighth of installed memory, from 512 MB to 4 GB, rounded
// down to a power of two: 8 GB machines get 1 GB, 16 GB get 2 GB.
export function automaticReplayMemoryMB(totalBytes: number): number {
   const totalGB = Math.round(totalBytes / 2 ** 30);
   const share = Math.min(4096, Math.max(512, (totalGB * 1024) / 8));
   return 2 ** Math.floor(Math.log2(share));
}
// Offer up to a quarter of installed memory, leaving room for the game.
// Windows reports slightly less than the installed amount, so round first.
export function replayMemoryChoicesFor(totalBytes: number): number[] {
   const limit = (Math.round(totalBytes / 2 ** 30) * 1024) / 4;
   return replayMemoryChoices.filter((megabytes) => megabytes <= limit);
}
export function resolveReplayMemoryMB(setting: number, totalBytes: number): number {
   if (setting === 0) return automaticReplayMemoryMB(totalBytes);
   return Math.min(replayMemoryBounds.max, Math.max(replayMemoryBounds.min, setting));
}
export function memoryLabel(megabytes: number): string {
   return megabytes >= 1024 ? `${Number((megabytes / 1024).toFixed(1))} GB` : `${megabytes} MB`;
}

// Lengths shown to people step in half minutes.
function halfMinutes(seconds: number, round: (value: number) => number): number {
   return seconds < 30 ? Math.floor(seconds) : round(seconds / 30) * 30;
}
export interface ReplayCapacity {
   // Clips up to this length keep full quality on busy gameplay. Rounded to
   // the nearest half minute, since only extreme footage wants more.
   fullQualitySeconds: number;
   // Clips up to this length always fit at the lowest bitrate ceiling. Most
   // gameplay reaches that floor, so this rounds down.
   fittingSeconds: number;
}
// The encoder ceiling divides memory across the clip length. Longer clips get
// a lower ceiling until it reaches the floor, after which busy scenes can
// outgrow memory and save a shorter clip.
export function replayCapacity(memoryMB: number, size: PixelSize, fps: number, audioTracks: number): ReplayCapacity {
   const historyKilobits = (historyShare * memoryMB * 1024 * 1024 * 8) / 1000;
   const audioKbps = audioTrackKbps * Math.max(1, audioTracks);
   const pixelKbps = Math.min(ceilingKbps, Math.max(floorKbps, (kbpsPerPixel * size.width * size.height * fps) / 1000));
   const busyKbps = Math.max(floorKbps, busyShare * pixelKbps);
   const fittingSeconds = halfMinutes(historyKilobits / (floorKbps + audioKbps), Math.floor);
   return {
      fullQualitySeconds: Math.min(fittingSeconds, halfMinutes(historyKilobits / (busyKbps + audioKbps), Math.round)),
      fittingSeconds,
   };
}
