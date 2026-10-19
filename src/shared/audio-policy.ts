import type { AdditionalAudioSource } from "./types";

export function needsMicrophonePermission(preferences: {
   microphone: boolean;
   audioSourcesVersion?: number;
   audioSources: ReadonlyArray<Pick<AdditionalAudioSource, "kind" | "enabled">>;
}): boolean {
   return (
      (preferences.audioSourcesVersion !== 2 && preferences.microphone) || preferences.audioSources.some((source) => source.enabled && source.kind === "input")
   );
}
