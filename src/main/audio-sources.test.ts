import { describe, expect, it } from "vitest";
import type { AdditionalAudioSource, GameCandidate } from "../shared/types";
import { resolveAudioSources } from "./audio-sources";
import { requiresCaptureRestart } from "./preferences";
import { defaultPreferences } from "../shared/defaults";
import { preferencesSchema } from "../shared/validation";

const source: AdditionalAudioSource = {
   id: "extra-game",
   name: "Game",
   kind: "application",
   deviceId: "",
   sourceId: "window:old",
   executable: "Game.exe",
   enabled: true,
   volume: 1,
   muted: false,
   includeInMaster: false,
};
const candidate: GameCandidate = { id: "window:new", name: "Game", executable: "Game.exe", pid: 42, foreground: true, fullscreen: false };
describe("additional audio bindings", () => {
   it("resolves a restarted application's current identity without mutating preferences", () => {
      expect(resolveAudioSources([source], [candidate])).toEqual([{ ...source, sourceId: "window:new", pid: 42 }]);
      expect(source.sourceId).toBe("window:old");
   });
   it("rejects a missing application instead of capturing another process or desktop", () => {
      expect(() => resolveAudioSources([source], [{ ...candidate, executable: "Other.exe" }])).toThrow("Game is unavailable");
      expect(resolveAudioSources([{ ...source, enabled: false }], [])).toEqual([{ ...source, enabled: false }]);
   });
   it("permits live gain and mute but requires stopping to change track layout or master inclusion", () => {
      const original = { ...defaultPreferences, collection: "test", audioSources: [source] };
      expect(requiresCaptureRestart(original, { ...original, audioSources: [{ ...source, volume: 0.5, muted: true }] })).toBe(false);
      expect(requiresCaptureRestart(original, { ...original, audioSources: [{ ...source, includeInMaster: true }] })).toBe(true);
      expect(requiresCaptureRestart(original, { ...original, audioSources: [] })).toBe(true);
   });
   it("limits isolated tracks and rejects duplicate or reserved source IDs at the IPC boundary", () => {
      expect(preferencesSchema.safeParse({ ...defaultPreferences, collection: "test", audioSources: [source, source] }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, collection: "test", audioSources: [{ ...source, id: "capture" }] }).success).toBe(false);
      expect(
         preferencesSchema.safeParse({
            ...defaultPreferences,
            collection: "test",
            audioSources: Array.from({ length: 6 }, (_, index) => ({ ...source, id: `source-${index}` })),
         }).success
      ).toBe(false);
   });
});
