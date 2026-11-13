import { mkdir, readFile, rename, open, copyFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Preferences } from "../shared/types";
import { defaultPreferences } from "../shared/defaults";
import { audioTopology, migrateAudioSources } from "../shared/audio-model";
import type { AdditionalAudioSource } from "../shared/types";
import { applyRecordingPreset } from "../shared/recording-presets";
import { preferencesSchema } from "../shared/validation";
import { z } from "zod";
import { migrateNotificationPreferences } from "../shared/notifications";
/** Settings errors reach the Settings page as text, so report the first problem plainly. */
function parsePreferences(value: unknown): Preferences {
   const result = preferencesSchema.safeParse(value);
   if (!result.success) throw new Error(result.error.issues[0]?.message ?? "Check your settings.");
   return result.data;
}
export function mergePreferenceChanges(current: Preferences, value: unknown, changedKeys: unknown): Preferences {
   const incoming = parsePreferences(value);
   if (changedKeys === undefined) return incoming;
   const keys = z.array(preferencesSchema.keyof()).max(100).parse(changedKeys);
   const merged = { ...current };
   for (const key of keys) Object.assign(merged, { [key]: incoming[key] });
   return parsePreferences(merged);
}
/**
 * "Reduce clip overlap" became one of three overlap choices. Existing settings
 * keep their behavior.
 */
function migrateOverlapPreference(stored: Record<string, unknown>): Partial<Preferences> {
   const { avoidOverlap, ...rest } = stored;
   if (rest["overlapClips"] !== undefined) return rest as Partial<Preferences>;
   return { ...rest, overlapClips: avoidOverlap === true ? "trim" : "keep" } as Partial<Preferences>;
}
/**
 * The usage history became part of the app rather than a choice. It stays on this computer and
 * Settings can clear it, so an old "off" is dropped with the setting.
 */
function dropRetiredPreferences(stored: Partial<Preferences>): Partial<Preferences> {
   const rest: Partial<Preferences> & { stats?: unknown } = { ...stored };
   delete rest.stats;
   return rest;
}
/** Every rename of a stored setting, applied before the schema sees the file. */
function migrateStoredPreferences(stored: unknown): Partial<Preferences> {
   return dropRetiredPreferences(migrateOverlapPreference(migrateNotificationPreferences(stored)));
}
export async function readPreferences(path: string, collection: string): Promise<Preferences> {
   for (const candidate of [path, `${path}.bak`]) {
      try {
         const stored: unknown = JSON.parse(await readFile(candidate, "utf8"));
         const legacy = migrateStoredPreferences(stored);
         const candidatePreferences = { ...defaultPreferences, collection, ...legacy };
         if (legacy.audioSourcesVersion !== 2) {
            candidatePreferences.audioSources = migrateAudioSources(candidatePreferences, (legacy.audioSources as AdditionalAudioSource[]) ?? []);
            candidatePreferences.audioSourcesVersion = 2;
         }
         const parsed = preferencesSchema.parse(candidatePreferences);
         const migrated =
            typeof stored === "object" && stored && !("recordingPresetVersion" in stored) && parsed.quality !== "custom"
               ? applyRecordingPreset(parsed, parsed.quality)
               : parsed;
         if (typeof stored === "object" && stored && !("resolutionLimit" in stored)) {
            // Retain legacy dimensions as stored metadata. The new screen limit
            // maps intentional custom geometry to its shorter edge; apps stay original.
            migrated.resolutionLimit =
               migrated.quality === "custom"
                  ? Math.min(migrated.customWidth, migrated.customHeight)
                  : migrated.quality === "low"
                    ? 720
                    : migrated.quality === "high"
                      ? 1440
                      : 1080;
         }
         // High once used CQ 18. Presets own their values, so only Custom keeps an edited CQ.
         if (migrated.quality === "high" && migrated.customCQ === 18) migrated.customCQ = 20;
         return migrated;
      } catch {
         /* Keep trying the last good backup. */
      }
   }
   return { ...defaultPreferences, collection };
}
export async function writePreferences(path: string, value: Preferences): Promise<void> {
   const parsed = preferencesSchema.parse(value);
   await mkdir(dirname(path), { recursive: true });
   const temporary = `${path}.${randomUUID()}.tmp`;
   try {
      const handle = await open(temporary, "wx");
      try {
         await handle.writeFile(JSON.stringify(parsed, null, 2));
         await handle.sync();
      } finally {
         await handle.close();
      }
      try {
         preferencesSchema.parse(migrateStoredPreferences(JSON.parse(await readFile(path, "utf8"))));
         await copyFile(path, `${path}.bak`);
      } catch (error) {
         if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof Error && error.name === "ZodError"))
            throw error;
      }
      await rename(temporary, path);
   } finally {
      await rm(temporary, { force: true });
   }
}
/** What capture is doing while a settings change applies. */
export interface PreferenceCapture {
   starting: boolean;
   /** Changes that rebuild the recorder must wait while this is true. */
   running: boolean;
   /** The collection folder can't change while capture, saves or shareables are in progress. */
   busy: boolean;
}
/**
 * Which edited keys can apply with capture as it is, and which must wait. Keys apply in order, so a
 * key only waits when adding it to the ones before would need capture to stop.
 */
export function splitHeldPreferences(
   current: Preferences,
   merge: (applied: Array<keyof Preferences>) => Preferences,
   keys: readonly (keyof Preferences)[],
   capture: PreferenceCapture
): { applied: Array<keyof Preferences>; deferred: Array<keyof Preferences> } {
   if (capture.starting) return { applied: [], deferred: [...keys] };
   const held = (next: Preferences) => (capture.running && requiresCaptureRestart(current, next)) || (next.collection !== current.collection && capture.busy);
   const applied: Array<keyof Preferences> = [];
   const deferred: Array<keyof Preferences> = [];
   for (const key of keys) {
      if (held(merge([...applied, key]))) deferred.push(key);
      else applied.push(key);
   }
   return { applied, deferred };
}
export function requiresCaptureRestart(a: Preferences, b: Preferences): boolean {
   return (
      a.clipSeconds !== b.clipSeconds ||
      a.quality !== b.quality ||
      a.resolutionLimit !== b.resolutionLimit ||
      a.customWidth !== b.customWidth ||
      a.customHeight !== b.customHeight ||
      a.customFPS !== b.customFPS ||
      a.customCQ !== b.customCQ ||
      a.allowSoftwareEncoder !== b.allowSoftwareEncoder ||
      a.replayMemoryMB !== b.replayMemoryMB ||
      a.microphoneDevice !== b.microphoneDevice ||
      a.captureAudio !== b.captureAudio ||
      (a.overlapClips === "trim") !== (b.overlapClips === "trim") ||
      audioTopology(a) !== audioTopology(b)
   );
}
