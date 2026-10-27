import type { AdditionalAudioSource } from "./types";

export function needsMicrophonePermission(preferences: {
   microphone: boolean;
   microphoneMuted?: boolean;
   audioSourcesVersion?: number;
   audioSources: ReadonlyArray<Pick<AdditionalAudioSource, "kind" | "enabled"> & Partial<Pick<AdditionalAudioSource, "muted">>>;
}): boolean {
   return (
      (preferences.audioSourcesVersion !== 2 && preferences.microphone && !preferences.microphoneMuted) ||
      preferences.audioSources.some((source) => source.enabled && !source.muted && source.kind === "input")
   );
}
