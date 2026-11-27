import type { AdditionalAudioSource, GameCandidate } from "../shared/types";

// A window ID can change after an application restarts. The executable remains
// the saved binding, and the current candidate supplies its verified PID.
// An application that isn't open keeps its track silent rather than holding up capture or the
// other meters. It is never bound to another process or to desktop audio instead.
export function resolveAudioSources(
   sources: AdditionalAudioSource[],
   candidates: GameCandidate[]
): { sources: Array<AdditionalAudioSource & { pid?: number }>; missing: AdditionalAudioSource[] } {
   const missing: AdditionalAudioSource[] = [];
   const resolved = sources.map((source) => {
      if (!source.enabled || source.kind !== "application") return { ...source };
      const matches = candidates.filter((candidate) => candidate.executable === source.executable && candidate.pid > 0);
      const target = matches.find((candidate) => candidate.id === source.sourceId) ?? matches.find((candidate) => candidate.foreground) ?? matches[0];
      if (!target) {
         missing.push(source);
         return { ...source, enabled: false };
      }
      return { ...source, sourceId: target.id, pid: target.pid };
   });
   return { sources: resolved, missing };
}

/**
 * Track issues, by source id, for application sources that weren't open when capture started. Where
 * capture attaches them once they open, the issue says so instead of asking for a restart.
 */
export function missingAudioIssues(missing: readonly Pick<AdditionalAudioSource, "id" | "name">[], attaches = false): Record<string, string> {
   return Object.fromEntries(
      missing.map((source) => [
         source.id,
         attaches
            ? `${source.name} isn't open. The track stays silent until it opens.`
            : `${source.name} isn't open, so the track stays silent. Restart capture after opening it.`,
      ])
   );
}
