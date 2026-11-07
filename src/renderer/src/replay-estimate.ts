import { useEffect, useState } from "react";
import type { Preferences } from "../../shared/types";
import { fitResolutionLimit } from "../../shared/recording-presets";
import { memoryLabel, replayCapacity, replayMemoryChoicesFor, resolveReplayMemoryMB } from "../../shared/replay-memory";
import type { ReplayCapacity } from "../../shared/replay-memory";
import { durationText } from "./TimeInput";
import { api } from "./desktop";

let memoryQuery: Promise<number | undefined> | null = null;
export function useInstalledMemory(): number | undefined {
   const [bytes, setBytes] = useState<number | undefined>();
   useEffect(() => {
      let current = true;
      memoryQuery ??= api
         .recordingCapabilities()
         .then((capabilities) => capabilities.memoryBytes)
         .catch(() => undefined);
      void memoryQuery.then((value) => {
         if (current) setBytes(value);
      });
      return () => {
         current = false;
      };
   }, []);
   return bytes;
}

export interface ReplayEstimate extends ReplayCapacity {
   memoryMB: number;
}
// Screens scale to the resolution limit. Games are usually fullscreen, so the
// primary display stands in for an application's size.
export function replayEstimate(value: Preferences, memoryBytes: number, memoryMB = resolveReplayMemoryMB(value.replayMemoryMB, memoryBytes)): ReplayEstimate {
   const ratio = window.devicePixelRatio || 1;
   const size = fitResolutionLimit({ width: Math.round(window.screen.width * ratio), height: Math.round(window.screen.height * ratio) }, value.resolutionLimit);
   const tracks = 1 + value.audioSources.filter((source) => source.enabled).length;
   return { memoryMB, ...replayCapacity(memoryMB, size, value.customFPS, tracks) };
}
export function clipLengthWarning(value: Preferences, memoryBytes: number | undefined): { message: string; error: boolean } | null {
   if (!memoryBytes) return null;
   const current = replayEstimate(value, memoryBytes);
   const error = value.clipSeconds > current.fittingSeconds;
   if (!error && value.clipSeconds <= current.fullQualitySeconds) return null;
   const holds = (estimate: ReplayEstimate) => (error ? estimate.fittingSeconds : estimate.fullQualitySeconds);
   const larger = replayMemoryChoicesFor(memoryBytes)
      .filter((megabytes) => megabytes > current.memoryMB)
      .map((megabytes) => replayEstimate(value, memoryBytes, megabytes));
   const enough = larger.find((estimate) => holds(estimate) >= value.clipSeconds);
   const largest = larger.at(-1);
   const memory = memoryLabel(current.memoryMB);
   const problem = error
      ? `Replay memory (${memory}) fits about ${durationText(current.fittingSeconds)} at this quality. Busy scenes may save shorter clips.`
      : `Clips over ${durationText(current.fullQualitySeconds)} may lower the quality of busy scenes to fit replay memory (${memory}).`;
   const remedy = error ? "shorten the clip or lower the quality" : "shorten the clip for full quality";
   const advice = enough
      ? `Raise it to ${memoryLabel(enough.memoryMB)} under Quality > Advanced${error ? ", or shorten the clip." : " for full quality."}`
      : largest
        ? `${memoryLabel(largest.memoryMB)}, the most offered on this PC, holds about ${durationText(holds(largest))}, so ${remedy}.`
        : `This is the most replay memory offered on this PC, so ${remedy}.`;
   return { error, message: `${problem} ${advice}` };
}
