import { describe, expect, it } from "vitest";
import { buildSystemReport, collectionSummary } from "./system-report";
import { defaultPreferences, stoppedRecorder } from "../shared/defaults";
import type { Clip } from "../shared/types";

const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
   id,
   path: `/clips/${id}.mp4`,
   relativePath: `${id}.mp4`,
   name: id,
   source: "Game",
   size: 1000,
   duration: 10.4,
   width: 1920,
   height: 1080,
   createdAt: 0,
   thumbnail: "",
   playbackUrl: "",
   tracks: [{ index: 0, title: "Game", codec: "aac" }],
   categories: [],
   shareables: [],
   ...extra,
});

describe("collectionSummary", () => {
   it("counts what helps diagnose a library without naming clips", () => {
      const summary = collectionSummary([
         clip("a"),
         clip("b", { path: "/clips/b.MKV", height: 720, tracks: [], originalMissing: true }),
         clip("c", {
            mergedFrom: 3,
            tracks: [
               { index: 0, title: "", codec: "aac" },
               { index: 1, title: "Mic", codec: "opus" },
            ],
         }),
      ]);
      expect(summary).toMatchObject({
         clips: 3,
         bytes: 3000,
         seconds: 31,
         missingOriginals: 1,
         merged: 1,
         withoutAudio: 1,
         multiTrack: 1,
         extensions: { ".mp4": 2, ".mkv": 1 },
         resolutions: { "1080p": 2, "720p": 1 },
      });
      expect(JSON.stringify(summary)).not.toContain("/clips/");
   });
});

describe("buildSystemReport", () => {
   it("keeps audio routing but drops device IDs", () => {
      const report = buildSystemReport({
         generatedAt: 61_000,
         app: { version: "1.0.0", packaged: true, portable: false, appImage: false, startedAt: 1000, locale: "en-US" },
         runtime: { electron: "44", chrome: "140", node: "24", v8: "14" },
         os: { platform: "linux", release: "6.12", version: "#1", arch: "x64", wayland: true },
         hardware: { cpu: "CPU", cores: 8, memoryBytes: 8, freeMemoryBytes: 4 },
         gpu: { features: {}, devices: [] },
         displays: [],
         recorder: { state: stoppedRecorder, capabilities: null },
         collection: { phase: "ready", clips: [], folders: 0, categories: 0, jobs: 0 },
         preferences: {
            ...defaultPreferences,
            audioSources: [
               {
                  id: "mic",
                  name: "Headset",
                  kind: "input",
                  deviceId: "alsa_input.usb-secret-serial",
                  sourceId: "",
                  executable: "",
                  enabled: true,
                  volume: 1,
                  muted: false,
                  includeInMaster: true,
                  filters: [{ id: "f", kind: "noise-suppression", enabled: false, settings: {} }],
               },
            ],
         },
         update: { state: "idle", version: "", progress: 0, message: "" },
         sessions: [
            { version: "0.9.0", pid: 1, startedAt: 0, clean: false, crash: "boom" },
            { version: "1.0.0", pid: 2, startedAt: 500, endedAt: 900, clean: true },
         ],
      });
      expect(report.app.uptimeSeconds).toBe(60);
      expect(report.preferences.audioSources).toEqual([
         { kind: "input", name: "Headset", enabled: true, muted: false, volume: 1, includeInMaster: true, filters: ["noise-suppression (off)"] },
      ]);
      expect(JSON.stringify(report)).not.toContain("secret-serial");
      expect(report.sessions.unclean).toBe(1);
      expect(report.sessions.recent[0]).toMatchObject({ clean: false, crash: "boom" });
   });
});
