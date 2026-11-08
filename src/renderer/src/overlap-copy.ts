import type { OverlapClips } from "../../shared/types";
import { formatTime } from "./format";
import { extendWindowSeconds } from "../../shared/extend-window";

/** Saving again soon after a clip is the moment this choice matters, so say how soon. */
export function overlapDetail(mode: OverlapClips, clipSeconds: number): string {
   if (mode === "merge") return `Saving again within ${formatTime(extendWindowSeconds(clipSeconds))} makes the previous clip longer.`;
   if (mode === "trim") return "Leave out footage already saved in the previous clip.";
   return "Every clip saves it's full length separately.";
}
