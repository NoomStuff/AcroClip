import { describe, expect, it } from "vitest";
import type { AdditionalAudioSource, GameCandidate } from "../shared/types";
import { missingAudioWarning, resolveAudioSources } from "./audio-sources";
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
   filters: [],
};
const candidate: GameCandidate = { id: "window:new", name: "Game", executable: "Game.exe", pid: 42, foreground: true, fullscreen: false };
describe("additional audio bindings", () => {
   it("resolves a restarted application's current identity without mutating preferences", () => {
      expect(resolveAudioSources([source], [candidate])).toEqual({ sources: [{ ...source, sourceId: "window:new", pid: 42 }], missing: [] });
      expect(source.sourceId).toBe("window:old");
   });
   it("leaves a missing application silent instead of capturing another process or desktop", () => {
      expect(resolveAudioSources([source], [{ ...candidate, executable: "Other.exe" }])).toEqual({
         sources: [{ ...source, enabled: false }],
         missing: ["Game"],
      });
      expect(resolveAudioSources([{ ...source, enabled: false }], [])).toEqual({ sources: [{ ...source, enabled: false }], missing: [] });
      expect(missingAudioWarning(["Discord"])).toBe("Discord isn't open, so its track is silent. Restart capture after opening it.");
      expect(missingAudioWarning(["Discord"], true)).toBe("Discord isn't open, so its track is silent until it opens.");
      expect(missingAudioWarning(["Discord", "Spotify"], true)).toBe("Discord and Spotify aren't open, so their tracks are silent until they open.");
      expect(missingAudioWarning(["Discord", "Spotify", "Game"])).toBe(
         "Discord, Spotify and Game aren't open, so their tracks are silent. Restart capture after opening them."
      );
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
