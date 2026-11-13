import { describe, expect, it } from "vitest";
import { StateChanges } from "./state-changes";
import { defaultPreferences, stoppedRecorder } from "../shared/defaults";
import { applyStatePatch } from "../shared/state-patch";
import type { AppEvent, AppState, Clip } from "../shared/types";

function snapshot(): AppState {
   return {
      windowVisible: true,
      storageWarning: "",
      preferences: structuredClone(defaultPreferences),
      clips: [],
      collectionStatus: { root: "/clips", phase: "ready" },
      folders: [],
      applicationIcons: {},
      categories: [],
      jobs: [],
      recorder: { ...stoppedRecorder },
      pendingPreferences: {},
      update: { state: "idle", version: "", progress: 0, message: "" },
      version: "test",
      platform: "win32",
   };
}
describe("incremental app state", () => {
   it("sends recorder reports only when they differ from what the renderer has", () => {
      const changes = new StateChanges();
      const state = snapshot();
      // Before the first snapshot every report goes out, for the renderer to replay.
      expect(changes.recorder(state.recorder)).toEqual({ type: "recorder", recorder: state.recorder });
      changes.event(state);
      expect(changes.recorder({ ...state.recorder })).toBeUndefined();
      const recording = { ...state.recorder, state: "recording" as const, availableSeconds: 4 };
      expect(changes.recorder(recording)).toEqual({ type: "recorder", recorder: recording });
      expect(changes.recorder({ ...recording })).toBeUndefined();
      // A full snapshot after that has no recorder news either.
      expect(changes.event({ ...state, recorder: { ...recording } })).toBeUndefined();
   });
   it("sends a full baseline, suppresses unchanged polls, and retains library references on status updates", () => {
      const changes = new StateChanges();
      const state = snapshot();
      expect(changes.event(state)).toEqual({ type: "state", state });
      expect(changes.event({ ...state, collectionStatus: { ...state.collectionStatus } })).toBeUndefined();
      state.recorder.availableSeconds = 12;
      const event = changes.event(state);
      expect(event).toEqual({ type: "state-patch", patch: { recorder: state.recorder } });
      expect(event?.type === "state-patch" && applyStatePatch(state, event)?.clips).toBe(state.clips);
   });
   it("detects mutable categories, job progress and replaced library arrays, including clearing values", () => {
      const changes = new StateChanges();
      const state = snapshot();
      state.storageWarning = "Low storage";
      changes.event(state);
      state.categories.push({ id: "a", name: "Game", color: "#abcdef" });
      state.jobs.push({ id: "j", clipId: "c", kind: "shareable", state: "running", progress: 0, message: "Creating shareable" });
      expect(changes.event(state)).toEqual({ type: "state-patch", patch: { categories: state.categories, jobs: state.jobs } });
      state.jobs[0]!.progress = 0.5;
      delete state.storageWarning;
      expect(changes.event(state)).toEqual({ type: "state-patch", patch: { jobs: state.jobs, storageWarning: undefined } });
      state.folders = ["Game"];
      expect(changes.event(state)).toEqual({ type: "state-patch", patch: { folders: ["Game"] } });
   });
   it("resynchronizes every field after a renderer reload", () => {
      const changes = new StateChanges();
      const state = snapshot();
      changes.event(state);
      changes.reset();
      expect(changes.event(state)).toEqual({ type: "state", state });
   });
});

describe("library changes", () => {
   const clip = (id: string, name = id): Clip => ({
      id,
      name,
      path: `/clips/${id}.mp4`,
      relativePath: `${id}.mp4`,
      source: "Game",
      size: 1,
      duration: 1,
      width: 1,
      height: 1,
      createdAt: 1,
      thumbnail: "",
      playbackUrl: "",
      tracks: [],
      categories: [],
      shareables: [],
   });
   it("sends only changed clips after a rescan and keeps unchanged renderer objects", () => {
      const changes = new StateChanges();
      const state = { ...snapshot(), clips: [clip("a"), clip("b"), clip("c")] };
      changes.event(state);
      let renderer: AppState = structuredClone(state);
      // A rescan builds new objects with the same content.
      expect(changes.event({ ...state, clips: state.clips.map((item) => ({ ...item })) })).toBeUndefined();
      const renamed = { ...state, clips: [clip("a"), clip("b", "Renamed"), clip("c")] };
      const event = changes.event(renamed);
      expect(event).toEqual({ type: "state-patch", patch: {}, clips: { upsert: [renamed.clips[1]] } });
      const before = renderer.clips;
      renderer = applyStatePatch(renderer, event as Extract<AppEvent, { type: "state-patch" }>)!;
      expect(renderer.clips[0]).toBe(before[0]);
      expect(renderer.clips[1]!.name).toBe("Renamed");
      const removed = changes.event({ ...renamed, clips: [renamed.clips[2]!, renamed.clips[0]!] });
      expect(removed).toEqual({ type: "state-patch", patch: {}, clips: { upsert: [], order: ["c", "a"] } });
      renderer = applyStatePatch(renderer, removed as Extract<AppEvent, { type: "state-patch" }>)!;
      expect(renderer.clips.map((item) => item.id)).toEqual(["c", "a"]);
   });
   it("asks for a reload when the renderer is missing a listed clip, and accepts full replacements", () => {
      const state = { ...snapshot(), clips: [clip("a")] };
      expect(applyStatePatch(state, { type: "state-patch", patch: {}, clips: { upsert: [], order: ["a", "b"] } })).toBeUndefined();
      expect(applyStatePatch(state, { type: "state-patch", patch: {}, clips: { upsert: [clip("b")] } })).toBeUndefined();
      expect(applyStatePatch(state, { type: "state-patch", patch: { clips: [clip("z")] } })?.clips.map((item) => item.id)).toEqual(["z"]);
   });
});
