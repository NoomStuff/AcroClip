import type { AdditionalAudioSource, GameCandidate, Preferences, CaptureSource } from "../shared/types";

// A window ID can change after an application restarts. The executable remains
// the saved binding, and the current candidate supplies its verified PID.
export function resolveAudioSources(sources: AdditionalAudioSource[], candidates: GameCandidate[]): Array<AdditionalAudioSource & { pid?: number }> {
   return sources.map((source) => {
      if (!source.enabled || source.kind !== "application") return { ...source };
      const matches = candidates.filter((candidate) => candidate.executable === source.executable && candidate.pid > 0);
      const target = matches.find((candidate) => candidate.id === source.sourceId) ?? matches.find((candidate) => candidate.foreground) ?? matches[0];
      if (!target) throw new Error(`${source.name} is unavailable. Open the application or disable its audio source.`);
      return { ...source, sourceId: target.id, pid: target.pid };
   });
}

export function assertDistinctAudioSources(value: Preferences, known: CaptureSource[]): void {
   const source = value.audioSources.find((item) => item.kind === "source" && item.enabled);
   const identities = new Set<string>();
   const appIdentity = (id: string) => {
      const hwnd = id.split(":")[1];
      const pid = known.find((item) => item.kind === "app" && item.id.split(":")[1] === hwnd)?.processId;
      return pid ? `app:${pid}` : `window:${hwnd}`;
   };
   if (source && value.sourceKind === "app") identities.add(appIdentity(value.sourceId));
   if (source && value.sourceKind === "screen") identities.add("output:default");
   for (const item of value.audioSources.filter((item) => item.kind !== "source")) {
      const key = item.kind === "application" ? appIdentity(item.sourceId) : `${item.kind}:${item.deviceId}`;
      if (identities.has(key)) throw new Error(`${item.name} is already included by another audio source.`);
      identities.add(key);
   }
}
