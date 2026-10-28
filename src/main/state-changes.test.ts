import { describe, expect, it } from "vitest";
import { StateChanges } from "./state-changes";
import { defaultPreferences, stoppedRecorder } from "../shared/defaults";
import type { AppState } from "../shared/types";

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
      update: { state: "idle", version: "", progress: 0, message: "" },
      version: "test",
      platform: "win32",
   };
}
describe("incremental app state", () => {
   it("sends a full baseline, suppresses unchanged polls, and retains library references on status updates", () => {
      const changes = new StateChanges();
      const state = snapshot();
      expect(changes.event(state)).toEqual({ type: "state", state });
      expect(changes.event({ ...state, collectionStatus: { ...state.collectionStatus } })).toBeUndefined();
      state.recorder.availableSeconds = 12;
      const event = changes.event(state);
      expect(event).toEqual({ type: "state-patch", patch: { recorder: state.recorder } });
      expect(event?.type === "state-patch" && { ...state, ...event.patch }.clips).toBe(state.clips);
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
