import { describe, expect, it } from "vitest";
import {
   audioFilterChainSchema,
   audioFilterDefinitions,
   audioFilterKinds,
   createAudioFilter,
   defaultAudioFilterSettings,
   maxAudioFilters,
} from "./audio-filters";
import { audioTopology, nativeAudioPreferences } from "./audio-model";
import { defaultPreferences } from "./defaults";
import { preferencesSchema } from "./validation";

describe("audio filters", () => {
   it("accepts every filter at OBS's defaults", () => {
      const chain = audioFilterKinds.slice(0, maxAudioFilters).map((kind) => createAudioFilter(kind, kind));
      expect(audioFilterChainSchema.parse(chain)).toEqual(chain);
      for (const kind of audioFilterKinds)
         for (const parameter of audioFilterDefinitions[kind].parameters) {
            expect(parameter.default).toBeGreaterThanOrEqual(parameter.min);
            expect(parameter.default).toBeLessThanOrEqual(parameter.max);
         }
   });
   it("fills settings a stored chain predates with defaults", () => {
      const [filter] = audioFilterChainSchema.parse([{ id: "c", kind: "compressor", enabled: true, settings: { ratio: 4 } }]);
      expect(filter!.settings).toEqual({ ...defaultAudioFilterSettings("compressor"), ratio: 4 });
   });
   it.each([
      [{ id: "g", kind: "gain", enabled: true, settings: { db: 31 } }],
      [{ id: "g", kind: "gain", enabled: true, settings: { db: Number.NaN } }],
      [{ id: "g", kind: "gain", enabled: true, settings: { volume: 1 } }],
      [{ id: "n", kind: "noise-gate", enabled: true, settings: { attack_time: 2.5 } }],
      [{ id: "u", kind: "upward-compressor", enabled: true, settings: { knee_width: 1.5 } }],
      [{ id: "e", kind: "expander", enabled: true, settings: { detector: "average" } }],
      [{ id: "v", kind: "vst", enabled: true, settings: {} }],
   ])("rejects settings OBS would not accept: %j", (filter) => {
      expect(audioFilterChainSchema.safeParse([filter]).success).toBe(false);
   });
   it("rejects duplicate identities and over-long chains", () => {
      expect(audioFilterChainSchema.safeParse([createAudioFilter("gain", "a"), createAudioFilter("limiter", "a")]).success).toBe(false);
      const long = Array.from({ length: maxAudioFilters + 1 }, (_, index) => createAudioFilter("gain", String(index)));
      expect(audioFilterChainSchema.safeParse(long).success).toBe(false);
   });
   it("loads sources saved before filters existed", () => {
      const legacy = {
         ...defaultPreferences,
         collection: "C:/Clips",
         audioSources: defaultPreferences.audioSources.map((source) => Object.fromEntries(Object.entries(source).filter(([key]) => key !== "filters"))),
      };
      expect(preferencesSchema.parse(legacy).audioSources.every((source) => source.filters.length === 0)).toBe(true);
   });
   it("keeps filters out of the capture topology", () => {
      const next = {
         ...defaultPreferences,
         audioSources: defaultPreferences.audioSources.map((source) => ({ ...source, filters: [createAudioFilter("noise-suppression", "ns")] })),
      };
      expect(audioTopology(next)).toBe(audioTopology(defaultPreferences));
      expect(nativeAudioPreferences(next).captureFilters).toEqual(next.audioSources[0]!.filters);
      expect(nativeAudioPreferences(next).audioSources[0]!.filters).toEqual(next.audioSources[1]!.filters);
   });
});
