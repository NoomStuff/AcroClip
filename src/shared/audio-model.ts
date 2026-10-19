import type { AdditionalAudioSource, Preferences } from "./types";
const sourceBase = { deviceId: "", sourceId: "", executable: "", volume: 1, muted: false, includeInMaster: false };
export function defaultAudioSources(): AdditionalAudioSource[] {
   return [
      { ...sourceBase, id: "source-audio", name: "Source audio", kind: "source", enabled: true },
      { ...sourceBase, id: "microphone-default", name: "Microphone", kind: "input", deviceId: "default", enabled: false },
   ];
}
export function migrateAudioSources(value: Preferences, extras: AdditionalAudioSource[]): AdditionalAudioSource[] {
   const unique = (name: string) => {
      let id = name;
      for (let i = 2; extras.some((source) => source.id === id); i++) id = `${name}-${i}`;
      return id;
   };
   const defaults = defaultAudioSources();
   return [
      { ...defaults[0]!, id: unique("source-audio"), enabled: value.captureAudio, volume: value.captureVolume, muted: value.captureMuted },
      {
         ...defaults[1]!,
         id: unique("microphone-default"),
         enabled: value.microphone,
         deviceId: value.microphoneDevice,
         volume: value.microphoneVolume,
         muted: value.microphoneMuted,
      },
      ...extras,
   ];
}
export function nativeAudioPreferences(value: Preferences) {
   if (value.audioSourcesVersion !== 2) return { ...value, automaticMaster: false, sourceAudioPresent: true };
   const source = value.audioSources.find((source) => source.kind === "source");
   return {
      ...value,
      captureAudio: source?.enabled ?? false,
      captureVolume: source?.volume ?? 1,
      captureMuted: source?.muted ?? false,
      microphone: false,
      audioSources: value.audioSources.filter((source) => source.kind !== "source"),
      automaticMaster: true,
      sourceAudioPresent: !!source,
      sourceAudioName: source?.name ?? "Source audio",
   };
}
export function synchronizeLegacyAudio(previous: Preferences, next: Preferences): Preferences {
   if (next.audioSourcesVersion !== 2) return next;
   let sources = next.audioSources;
   if (JSON.stringify(previous.audioSources) === JSON.stringify(next.audioSources)) {
      if (previous.captureAudio !== next.captureAudio || previous.captureVolume !== next.captureVolume || previous.captureMuted !== next.captureMuted)
         sources = sources.map((source) =>
            source.kind === "source" ? { ...source, enabled: next.captureAudio, volume: next.captureVolume, muted: next.captureMuted } : source
         );
      if (
         previous.microphone !== next.microphone ||
         previous.microphoneDevice !== next.microphoneDevice ||
         previous.microphoneVolume !== next.microphoneVolume ||
         previous.microphoneMuted !== next.microphoneMuted
      )
         sources = sources.map((source) =>
            source.id.startsWith("microphone-default") && source.kind === "input"
               ? { ...source, enabled: next.microphone, deviceId: next.microphoneDevice, volume: next.microphoneVolume, muted: next.microphoneMuted }
               : source
         );
   }
   const source = sources.find((source) => source.kind === "source"),
      microphone = sources.find((source) => source.id.startsWith("microphone-default") && source.kind === "input");
   return {
      ...next,
      audioSources: sources,
      captureAudio: source?.enabled ?? false,
      captureVolume: source?.volume ?? next.captureVolume,
      captureMuted: source?.muted ?? false,
      microphone: microphone?.enabled ?? false,
      microphoneDevice: microphone?.deviceId ?? next.microphoneDevice,
      microphoneVolume: microphone?.volume ?? next.microphoneVolume,
      microphoneMuted: microphone?.muted ?? false,
   };
}

// Missing capture selections must not silence independent microphones or devices.
export function monitoringPreferences(preferences: Preferences, captureAvailable: boolean): Preferences {
   if (captureAvailable) return preferences;
   return {
      ...preferences,
      captureAudio: false,
      audioSources: preferences.audioSources.map((source) => (source.kind === "source" ? { ...source, enabled: false } : source)),
   };
}
