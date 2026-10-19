import { mkdir, readFile, rename, open, copyFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Preferences } from "../shared/types";
import { defaultPreferences } from "../shared/defaults";
import { migrateAudioSources } from "../shared/audio-model";
import type { AdditionalAudioSource } from "../shared/types";
import { applyRecordingPreset } from "../shared/recording-presets";
import { preferencesSchema } from "../shared/validation";
export async function readPreferences(path: string, collection: string): Promise<Preferences> {
   for (const candidate of [path, `${path}.bak`]) {
      try {
         const stored: unknown = JSON.parse(await readFile(candidate, "utf8"));
         const legacy = typeof stored === "object" && stored ? (stored as Partial<Preferences>) : {};
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
         preferencesSchema.parse(JSON.parse(await readFile(path, "utf8")));
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
      a.microphone !== b.microphone ||
      a.microphoneDevice !== b.microphoneDevice ||
      a.captureAudio !== b.captureAudio ||
      a.avoidOverlap !== b.avoidOverlap ||
      JSON.stringify(a.audioSources.map((source) => ({ ...source, volume: 1, muted: false }))) !==
         JSON.stringify(b.audioSources.map((source) => ({ ...source, volume: 1, muted: false })))
   );
}
