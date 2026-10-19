import { describe, it, expect } from "vitest";
import { defaultPreferences } from "./defaults";
import { defaultAudioSources, migrateAudioSources, nativeAudioPreferences, synchronizeLegacyAudio, monitoringPreferences } from "./audio-model";
describe("unified audio source preferences", () => {
   it("starts with Source audio and a disabled default microphone without opening it", () => {
      const sources = defaultAudioSources();
      expect(sources.map((source) => source.kind)).toEqual(["source", "input"]);
      expect(sources[1]).toMatchObject({ deviceId: "default", enabled: false });
      const native = nativeAudioPreferences(defaultPreferences);
      expect(native.microphone).toBe(false);
      expect(native.audioSources[0]).toMatchObject({ kind: "input", enabled: false });
      expect(native.automaticMaster).toBe(true);
   });
   it("migrates source scope, gain, mute and the microphone device and retains custom source identities", () => {
      const extra = { ...defaultAudioSources()[1]!, id: "existing-input", deviceId: "usb-mic", enabled: true, volume: 0.4 };
      const result = migrateAudioSources(
         {
            ...defaultPreferences,
            captureAudio: false,
            captureMuted: true,
            captureVolume: 0.7,
            microphone: true,
            microphoneDevice: "chosen-mic",
            microphoneVolume: 0.2,
            microphoneMuted: true,
         },
         [extra]
      );
      expect(result[0]).toMatchObject({ kind: "source", enabled: false, muted: true, volume: 0.7 });
      expect(result[1]).toMatchObject({ kind: "input", enabled: true, deviceId: "chosen-mic", muted: true, volume: 0.2 });
      expect(result[2]).toEqual(extra);
   });
   it("keeps removed defaults removed, including when legacy fields later change", () => {
      const empty = { ...defaultPreferences, audioSources: [] };
      expect(nativeAudioPreferences(empty)).toMatchObject({ captureAudio: false, microphone: false, sourceAudioPresent: false, audioSources: [] });
      expect(synchronizeLegacyAudio(empty, { ...empty, captureAudio: true, microphone: true }).audioSources).toEqual([]);
   });
});

it("keeps independent audio monitoring when capture has no valid selection", () => {
   const preferences = {
      ...defaultPreferences,
      captureAudio: true,
      microphone: true,
      audioSources: defaultAudioSources().map((source) => ({ ...source, enabled: true })),
   };
   const monitor = monitoringPreferences(preferences, false);
   expect(monitor.captureAudio).toBe(false);
   expect(monitor.microphone).toBe(true);
   expect(monitor.audioSources.find((source) => source.kind === "source")?.enabled).toBe(false);
   expect(monitor.audioSources.find((source) => source.kind === "input")).toEqual(preferences.audioSources.find((source) => source.kind === "input"));
   expect(preferences.audioSources.every((source) => source.enabled)).toBe(true);
   expect(preferences.captureAudio).toBe(true);
});
