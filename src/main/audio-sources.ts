import type { AdditionalAudioSource, GameCandidate } from "../shared/types";

// A window ID can change after an application restarts. The executable remains
// the saved binding, and the current candidate supplies its verified PID.
// An application that isn't open keeps its track silent rather than holding up capture or the
// other meters. It is never bound to another process or to desktop audio instead.
export function resolveAudioSources(
   sources: AdditionalAudioSource[],
   candidates: GameCandidate[]
): { sources: Array<AdditionalAudioSource & { pid?: number }>; missing: string[] } {
   const missing: string[] = [];
   const resolved = sources.map((source) => {
      if (!source.enabled || source.kind !== "application") return { ...source };
      const matches = candidates.filter((candidate) => candidate.executable === source.executable && candidate.pid > 0);
      const target = matches.find((candidate) => candidate.id === source.sourceId) ?? matches.find((candidate) => candidate.foreground) ?? matches[0];
      if (!target) {
         missing.push(source.name);
         return { ...source, enabled: false };
      }
      return { ...source, sourceId: target.id, pid: target.pid };
   });
   return { sources: resolved, missing };
}

/**
 * The status line for application sources that weren't open when capture started. Where capture
 * attaches them once they open, the line says so instead of asking for a restart.
 */
export function missingAudioWarning(missing: readonly string[], attaches = false): string {
   if (!missing.length) return "";
   const one = missing.length === 1;
   const names = one ? missing[0]! : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)!}`;
   const silent = `${names} ${one ? "isn't" : "aren't"} open, so ${one ? "its track is" : "their tracks are"} silent`;
   return attaches ? `${silent} until ${one ? "it opens" : "they open"}.` : `${silent}. Restart capture after opening ${one ? "it" : "them"}.`;
}
