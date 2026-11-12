import { extname } from "node:path";
import type { Clip, Preferences, RecorderState, RecordingCapabilities, UpdateState } from "../shared/types";
import type { SessionRecord } from "./diagnostics";

interface DisplayInfo {
   width: number;
   height: number;
   scaleFactor: number;
   refreshRate: number;
   primary: boolean;
}

export interface SystemReportInput {
   generatedAt: number;
   app: { version: string; packaged: boolean; portable: boolean; appImage: boolean; startedAt: number; locale: string };
   runtime: { electron: string; chrome: string; node: string; v8: string };
   os: { platform: NodeJS.Platform; release: string; version: string; arch: string; wayland: boolean; desktop?: string };
   hardware: { cpu: string; cores: number; memoryBytes: number; freeMemoryBytes: number };
   gpu: { features: Record<string, string>; devices: Array<{ vendorId?: number; deviceId?: number; driver?: string }> };
   displays: DisplayInfo[];
   recorder: { state: RecorderState; capabilities: RecordingCapabilities | null };
   collection: { phase: string; error?: string; clips: Clip[]; folders: number; categories: number; jobs: number; freeBytes?: number };
   preferences: Preferences;
   update: UpdateState;
   sessions: SessionRecord[];
}

/** Counts, never names: enough to spot a huge library or a broken scan. */
export function collectionSummary(clips: Clip[]) {
   const extensions: Record<string, number> = {};
   let bytes = 0;
   let seconds = 0;
   let shareables = 0;
   for (const clip of clips) {
      const extension = extname(clip.path).toLowerCase() || "(none)";
      extensions[extension] = (extensions[extension] ?? 0) + 1;
      bytes += clip.size;
      seconds += clip.duration;
      shareables += clip.shareables.length;
   }
   const resolutions: Record<string, number> = {};
   for (const clip of clips) {
      const key = clip.height ? `${clip.height}p` : "unknown";
      resolutions[key] = (resolutions[key] ?? 0) + 1;
   }
   return {
      clips: clips.length,
      bytes,
      seconds: Math.round(seconds),
      shareables,
      missingOriginals: clips.filter((clip) => clip.originalMissing).length,
      unverified: clips.filter((clip) => clip.availability === "unverified").length,
      merged: clips.filter((clip) => (clip.mergedFrom ?? 0) > 1).length,
      withoutAudio: clips.filter((clip) => clip.tracks.length === 0).length,
      multiTrack: clips.filter((clip) => clip.tracks.length > 1).length,
      extensions,
      resolutions,
   };
}

/**
 * Settings as a bug report needs them. Shortcuts, quality and audio routing explain most
 * "it doesn't record" reports; the collection path stays so a network drive is visible.
 */
function reportedPreferences(preferences: Preferences) {
   return {
      ...preferences,
      audioSources: preferences.audioSources.map((source) => ({
         kind: source.kind,
         name: source.name,
         enabled: source.enabled,
         muted: source.muted,
         volume: source.volume,
         includeInMaster: source.includeInMaster,
         filters: source.filters.map((filter) => `${filter.kind}${filter.enabled ? "" : " (off)"}`),
      })),
   };
}

export function buildSystemReport(input: SystemReportInput) {
   const recentSessions = input.sessions.slice(-20);
   return {
      generatedAt: new Date(input.generatedAt).toISOString(),
      app: {
         ...input.app,
         startedAt: new Date(input.app.startedAt).toISOString(),
         uptimeSeconds: Math.round((input.generatedAt - input.app.startedAt) / 1000),
      },
      runtime: input.runtime,
      os: input.os,
      hardware: input.hardware,
      gpu: input.gpu,
      displays: input.displays,
      recorder: {
         state: input.recorder.state.state,
         message: input.recorder.state.message,
         backend: input.recorder.state.backend,
         supported: input.recorder.state.supported,
         sourceKind: input.recorder.state.sourceKind,
         bufferedSourceKind: input.recorder.state.bufferedSourceKind,
         availableSeconds: input.recorder.state.availableSeconds,
         pendingSaves: input.recorder.state.pendingSaves,
         audioWarning: input.recorder.state.audioWarning,
         historyWarning: input.recorder.state.historyWarning,
         capabilities: input.recorder.capabilities,
      },
      collection: {
         phase: input.collection.phase,
         error: input.collection.error,
         folders: input.collection.folders,
         categories: input.collection.categories,
         jobs: input.collection.jobs,
         freeBytes: input.collection.freeBytes,
         ...collectionSummary(input.collection.clips),
      },
      preferences: reportedPreferences(input.preferences),
      update: { state: input.update.state, version: input.update.version, message: input.update.message, mode: input.update.mode },
      sessions: {
         recent: recentSessions.map((session) => ({
            version: session.version,
            startedAt: new Date(session.startedAt).toISOString(),
            endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
            clean: session.clean,
            ...(session.crash ? { crash: session.crash } : {}),
         })),
         unclean: recentSessions.filter((session) => !session.clean).length,
      },
   };
}
