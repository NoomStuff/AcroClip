import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../shared/defaults";
import { preferencesSchema } from "../shared/validation";
import { readPreferences, requiresCaptureRestart, writePreferences } from "./preferences";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
describe("recording settings boundaries", () => {
   it("permits source switches and notification preferences without rebuilding capture", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, sourceId: "window:11:0", sourceKind: "app", sound: false })).toBe(false);
   });
   it("requires restart for audio routing and encoding changes", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, microphone: true })).toBe(true);
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, quality: "high" })).toBe(true);
   });
   it("applies bounded gain and mute changes without clearing recorded history", () => {
      expect(requiresCaptureRestart(defaultPreferences, { ...defaultPreferences, captureVolume: 0.5, microphoneMuted: true })).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, captureVolume: 4.1 }).success).toBe(false);
      expect(preferencesSchema.safeParse({ ...defaultPreferences, microphoneVolume: -1 }).success).toBe(false);
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
describe("preference persistence recovery", () => {
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
         customCQ: 18,
         microphone: false,
         recordingPresetVersion: 1,
      });
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
         expect(initial.sound).toBe(false);
         expect(initial.shortcut).toBe("Control+Shift+F8");
         expect(initial.shortcuts.toggleRecording).toBe("Control+Shift+F9");
         await writePreferences(path, initial);
         await writePreferences(path, { ...initial, sound: true });
         await writeFile(path, "damaged");
         const recovered = await readPreferences(path, root);
         expect(recovered.sound).toBe(false);
         await writePreferences(path, recovered);
         expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ collection: root, sound: false });
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});
