interface ToggleableTrack {
   enabled: boolean;
}
/** The part of Chromium's AudioTrackList the player uses. TypeScript's DOM types omit it. */
export interface AudioTrackToggles {
   readonly length: number;
   readonly [index: number]: ToggleableTrack | undefined;
}

/** The main process enables Chromium's AudioVideoTracks feature, which adds `audioTracks`. */
export const nativeAudioTracks = typeof HTMLMediaElement !== "undefined" && "audioTracks" in HTMLMediaElement.prototype;

export function mediaAudioTracks(media: HTMLMediaElement): AudioTrackToggles | undefined {
   return (media as HTMLMediaElement & { audioTracks?: AudioTrackToggles }).audioTracks;
}

/**
 * Enables exactly the selected tracks. Chromium plays one enabled track and doesn't mix them,
 * so callers pass one. Returns false when the element's tracks don't line up with the clip's,
 * so a prepared copy is needed.
 */
export function selectAudioTracks(list: AudioTrackToggles | undefined, tracks: readonly { index: number }[], selected: readonly number[]): boolean {
   if (!list || list.length !== tracks.length) return false;
   const wanted = tracks.map((track) => selected.includes(track.index));
   // Enable before disabling, so playback never passes through a moment without audio.
   for (const enable of [true, false])
      for (const [ordinal, item] of Array.from({ length: list.length }, (_, index) => list[index]).entries())
         if (item && wanted[ordinal] === enable && item.enabled !== enable) item.enabled = enable;
   return true;
}
