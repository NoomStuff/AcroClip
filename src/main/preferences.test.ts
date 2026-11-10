import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../shared/defaults";
import { preferencesSchema } from "../shared/validation";
import { mergePreferenceChanges, readPreferences, requiresCaptureRestart, writePreferences } from "./preferences";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { synchronizeLegacyAudio } from "../shared/audio-model";
import { createAudioFilter } from "../shared/audio-filters";
import { notificationActions } from "../shared/notifications";
describe("recording settings boundaries", () => {
   it("merges an autosave at write time without overwriting another queued edit", () => {
      const before = { ...defaultPreferences, collection: "clips", notificationStopSound: true };
      const draft = { ...before, clipSeconds: 74 };
      const afterExternalWrite = { ...before, notificationStopSound: false, shareSizeMB: 35 };
      expect(mergePreferenceChanges(afterExternalWrite, draft, ["clipSeconds"])).toMatchObject({
         clipSeconds: 74,
         notificationStopSound: false,
         shareSizeMB: 35,
      });
      expect(mergePreferenceChanges(afterExternalWrite, draft, undefined)).toEqual(draft);
      expect(() => mergePreferenceChanges(afterExternalWrite, draft, ["unrecognized-setting"])).toThrow();
   });
   it("saves one notification control without overwriting another row", () => {
      const before = preferencesSchema.parse({ ...defaultPreferences, collection: "clips" });
      const draft = { ...before, notificationStartBanner: false };
      const external = { ...before, notificationStopSound: false };
      const merged = mergePreferenceChanges(external, draft, ["notificationStartBanner"]);
      expect(merged).toMatchObject({
         notificationStartBanner: false,
         notificationStartSound: true,
         notificationStopSound: false,
         notificationErrorBanner: true,
      });
      expect(requiresCaptureRestart(before, merged)).toBe(false);
   });
   it("permits source switches and notification preferences without rebuilding capture", () => {
      expect(
         requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, sourceId: "window:11:0", sourceKind: "app", notificationStopSound: false })
      ).toBe(false);
   });
   it("requires restart for audio routing and encoding changes", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, microphoneDevice: "another-device" })).toBe(true);
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, quality: "high" })).toBe(true);
   });
   it("applies bounded gain and mute changes without clearing recorded history", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, captureVolume: 0.5, microphoneMuted: true })).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, captureVolume: 4.1 }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, microphoneVolume: -1 }).success).toBe(false);
   });
   it("applies audio filter changes without clearing recorded history", () => {
      const filtered = {
         ...defaultPreferences,
         audioSources: defaultPreferences.audioSources.map((source) => ({ ...source, filters: [createAudioFilter("noise-suppression", "ns")] })),
      };
      expect(requiresCaptureRestart(defaultPreferences, filtered)).toBe(false);
   });
   it("unmutes the default microphone during capture without rebuilding its track", () => {
      const before = preferencesSchema.parse({ ...defaultPreferences, collection: "clips" });
      const after = synchronizeLegacyAudio(before, {
         ...before,
         audioSources: before.audioSources.map((source) => (source.kind === "input" ? { ...source, muted: false } : source)),
      });
      expect(after.audioSources[1]).toMatchObject({ enabled: true, muted: false });
      expect(requiresCaptureRestart(before, after)).toBe(false);
      expect(requiresCaptureRestart(after, synchronizeLegacyAudio(after, { ...after, microphone: false }))).toBe(false);
   });
   it("requires stopping for custom profile changes and rejects dimensions incompatible with subsampled video", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, customFPS: 120 })).toBe(true);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, quality: "custom", customWidth: 1921 }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, customHeight: 0 }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, customFPS: 240 }).success).toBe(false);
   });
   it("rejects unbounded buffering and invalid output budgets at the IPC boundary", () => {
      expect(preferencesSchema.safeParse({ ...defaultPreferences, clipSeconds: Infinity }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, shareSizeMB: 0 }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, unknown: true }).success).toBe(false);
   });
});
describe("overlapping clip choice", () => {
   it("restarts capture only when the recorder's own trimming changes", () => {
      const merge = { ...defaultPreferences, overlapClips: "merge" as const };
      expect(requiresCaptureRestart(merge, { ...merge, overlapClips: "keep" })).toBe(false);
      expect(requiresCaptureRestart(merge, { ...merge, overlapClips: "trim" })).toBe(true);
   });
   it("keeps the behavior of the retired overlap toggle and saves normally on new installs", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-overlap-migration-"));
      try {
         const file = join(root, "preferences.json");
         const legacy: Record<string, unknown> = { ...defaultPreferences, collection: root };
         delete legacy["overlapClips"];
         for (const [avoidOverlap, expected] of [
            [true, "trim"],
            [false, "keep"],
            [undefined, "keep"],
         ] as const) {
            await writeFile(file, JSON.stringify({ ...legacy, ...(avoidOverlap === undefined ? {} : { avoidOverlap }) }));
            const value = await readPreferences(file, root);
            expect(value.overlapClips).toBe(expected);
            expect(value).not.toHaveProperty("avoidOverlap");
         }
         await writeFile(file, JSON.stringify({ ...legacy, avoidOverlap: true, overlapClips: "merge" }));
         expect((await readPreferences(file, root)).overlapClips).toBe("merge");
         expect((await readPreferences(join(root, "missing.json"), root)).overlapClips).toBe("keep");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});
describe("preference persistence recovery", () => {
   it("migrates and backs up old global notification choices without resetting the collection", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-notification-migration-"));
      try {
         const file = join(root, "preferences.json");
         const legacy: Record<string, unknown> = { ...defaultPreferences, collection: root, clipSeconds: 95, notifications: "off", sound: false };
         for (const keys of Object.values(notificationActions)) {
            delete legacy[keys.banner];
            if ("sound" in keys) delete legacy[keys.sound];
         }
         await writeFile(file, JSON.stringify(legacy));
         const migrated = await readPreferences(file, root);
         expect(migrated).toMatchObject({
            collection: root,
            clipSeconds: 95,
            notificationStartBanner: false,
            notificationSaveSound: false,
            notificationErrorBanner: true,
         });
         await writePreferences(file, { ...migrated, notificationStartBanner: true });
         expect(JSON.parse(await readFile(`${file}.bak`, "utf8"))).toMatchObject({ notifications: "off", sound: false });
         await writeFile(file, "damaged");
         expect(await readPreferences(file, root)).toMatchObject({
            collection: root,
            clipSeconds: 95,
            notificationStartBanner: false,
            notificationErrorBanner: true,
         });
      } finally {
         await rm(root, { force: true, recursive: true });
      }
   });
   it("drops the retired refresh shortcut without resetting other preferences", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-retired-shortcut-"));
      try {
         const path = join(root, "preferences.json");
         await writeFile(
            path,
            JSON.stringify({ ...defaultPreferences, collection: root, clipSeconds: 90, shortcuts: { refresh: "Control+R", search: "Control+G" } })
         );
         const value = await readPreferences(path, root);
         expect(value.clipSeconds).toBe(90);
         expect(value.shortcuts).toEqual({ search: "Control+G" });
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("migrates legacy preset fields to their previous actual profile without changing Custom or audio", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-preset-migration-"));
      const file = join(root, "preferences.json");
      const legacy: Partial<typeof defaultPreferences> = { ...defaultPreferences };
      delete legacy.recordingPresetVersion;
      await writeFile(file, JSON.stringify({ ...legacy, collection: root, quality: "high", customWidth: 1280, customCQ: 31, microphone: false }));
      expect(await readPreferences(file, root)).toMatchObject({
         quality: "high",
         customWidth: 2560,
         customHeight: 1440,
         customCQ: 20,
         microphone: false,
         recordingPresetVersion: 1,
      });
      await writeFile(file, JSON.stringify({ ...defaultPreferences, collection: root, quality: "high", resolutionLimit: 1440, customCQ: 18 }));
      expect(await readPreferences(file, root)).toMatchObject({ quality: "high", resolutionLimit: 1440, customCQ: 20 });
      await writeFile(file, JSON.stringify({ ...defaultPreferences, collection: root, quality: "custom", customCQ: 18 }));
      expect(await readPreferences(file, root)).toMatchObject({ quality: "custom", customCQ: 18 });
      await writeFile(file, JSON.stringify({ ...legacy, collection: root, quality: "custom", customWidth: 1280, customCQ: 31 }));
      expect(await readPreferences(file, root)).toMatchObject({ quality: "custom", customWidth: 1280, customCQ: 31 });
      await rm(root, { recursive: true, force: true });
   });

   it("uses the chosen collection for missing fields and recovers a damaged primary from backup", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-preferences-"));
      const path = join(root, "preferences.json");
      try {
         await writeFile(path, JSON.stringify({ sound: false, shortcut: "Control+Shift+F8", shortcuts: { toggleRecording: "Control+Shift+F9" } }));
         const initial = await readPreferences(path, root);
         expect(initial.collection).toBe(root);
         expect(initial.notificationStopSound).toBe(false);
         expect(initial.shortcut).toBe("Control+Shift+F8");
         expect(initial.shortcuts.toggleRecording).toBe("Control+Shift+F9");
         await writePreferences(path, initial);
         await writePreferences(path, { ...initial, notificationStopSound: true });
         await writeFile(path, "damaged");
         const recovered = await readPreferences(path, root);
         expect(recovered.notificationStopSound).toBe(false);
         await writePreferences(path, recovered);
         expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ collection: root, notificationStopSound: false });
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});
