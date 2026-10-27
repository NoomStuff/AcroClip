import type { AdditionalAudioSource, Preferences } from "./types";
const sourceBase = { deviceId: "", sourceId: "", executable: "", volume: 1, muted: false, includeInMaster: false };
export function isDefaultMicrophone(source: Pick<AdditionalAudioSource, "id" | "kind">): boolean {
   return /^microphone-default(?:-\d+)?$/.test(source.id) && source.kind === "input";
}
export function normalizeMicrophone(source: AdditionalAudioSource): AdditionalAudioSource {
   return isDefaultMicrophone(source) ? { ...source, enabled: true, muted: !source.enabled || source.muted } : source;
}
export function defaultAudioSources(): AdditionalAudioSource[] {
   return [
      { ...sourceBase, id: "source-audio", name: "Source audio", kind: "source", enabled: true },
      { ...sourceBase, id: "microphone-default", name: "Microphone", kind: "input", deviceId: "default", enabled: true, muted: true },
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
         enabled: true,
         deviceId: value.microphoneDevice,
         volume: value.microphoneVolume,
         muted: !value.microphone || value.microphoneMuted,
      },
      ...extras,
   ];
}
export function nativeAudioPreferences(value: Preferences) {
   const source = value.audioSources.find((source) => source.kind === "source");
   return {
      ...value,
      captureAudio: source?.enabled ?? false,
      captureVolume: source?.volume ?? 1,
      captureMuted: source?.muted ?? false,
      microphone: false,
      audioSources: value.audioSources
         .filter((source) => source.kind !== "source")
         .map((source) => {
            const normalized = normalizeMicrophone(source);
            return isDefaultMicrophone(normalized) ? { ...normalized, name: "Microphone" } : normalized;
         }),
      automaticMaster: true,
      sourceAudioPresent: !!source,
      sourceAudioName: value.sourceKind === "screen" ? "Desktop" : "Application",
   };
}
export function synchronizeLegacyAudio(previous: Preferences, next: Preferences): Preferences {
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
            isDefaultMicrophone(source)
               ? { ...source, enabled: true, deviceId: next.microphoneDevice, volume: next.microphoneVolume, muted: !next.microphone || next.microphoneMuted }
               : source
         );
   }
   sources = sources.map(normalizeMicrophone);
   const source = sources.find((source) => source.kind === "source"),
      microphone = sources.find(isDefaultMicrophone);
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

export function audioTopology(preferences: Preferences): string {
   return JSON.stringify(preferences.audioSources.map((source) => ({ ...source, volume: 1, muted: false })));
}
