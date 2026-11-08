import type { OverlapClips } from "../shared/types";
import { extendWindowSeconds } from "../shared/extend-window";

/** Where a saved clip's footage sits on the wall clock, in milliseconds. */
export interface SavedFootage {
   clipId: string;
   start: number;
   end: number;
   // One capture session and source. Clips from different sessions never share packets.
   session: string;
}

export function footageWindow(requestedAt: number, secondsSinceCapture: number, duration: number): { start: number; end: number } {
   const end = requestedAt - Math.max(0, secondsSinceCapture) * 1000;
   return { start: end - Math.max(0, duration) * 1000, end };
}

/** Merged clips stop growing here. Longer sessions belong in a full recording. */
export function mergeLimitSeconds(clipSeconds: number): number {
   return Math.min(600, 5 * clipSeconds);
}

/**
 * The cheap check made when a save lands, so its notice can already say what
 * happened. The merge itself still verifies every shared packet.
 */
export function mergeCandidate(
   previous: SavedFootage | undefined,
   next: SavedFootage,
   options: { mode: OverlapClips; clipSeconds: number; previousUntouched: boolean }
): { merge: true; seconds: number } | { merge: false } {
   if (options.mode !== "merge" || !previous || !options.previousUntouched) return { merge: false };
   if (previous.clipId === next.clipId || previous.session !== next.session || !next.session) return { merge: false };
   if (!(next.start < previous.end) || !(next.end > previous.end)) return { merge: false };
   if (next.end - previous.end > extendWindowSeconds(options.clipSeconds) * 1000) return { merge: false };
   const seconds = (next.end - previous.start) / 1000;
   if (seconds > mergeLimitSeconds(options.clipSeconds)) return { merge: false };
   return { merge: true, seconds };
}
