import { expect, it } from "vitest";
import { stoppedRecorder } from "../shared/defaults";
import { ARMED_AFTER_MS, PAUSE_AFTER_MS, RecordingNotices, SOURCE_READY_MS, type RecordingNotice } from "./recording-notices";
import type { RecorderState } from "../shared/types";

function fixture() {
   const notices: RecordingNotice[] = [];
   let clock = 0;
   const feedback = new RecordingNotices(
      (notice) => notices.push(notice),
      () => clock
   );
   const state = (changes: Partial<RecorderState>) => feedback.state({ ...stoppedRecorder, ...changes });
   /** Status arrives about once a second, so time passes between polls. */
   const after = (ms: number, changes: Partial<RecorderState>) => {
      clock += ms;
      state(changes);
   };
   const kinds = () => notices.map((notice) => notice.kind);
   return { notices, feedback, state, after, kinds };
}
const capturing = { state: "recording", availableSeconds: 1, sourceKind: "app", sourceName: "HASTE" } as const;
it("acknowledges a start immediately, then confirms usable footage once", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("Screen 1");
   expect(notices).toEqual([{ kind: "recording-starting", message: "Starting capture...", detail: "Screen 1", error: false }]);
   state({ state: "starting" });
   state({ ...capturing, availableSeconds: 0 });
   expect(notices).toHaveLength(3);
   expect(notices.every((notice) => notice.message === "Starting capture...")).toBe(true);
   expect(feedback.startingDetail).toBe("Waiting for source");
   state(capturing);
   state({ ...capturing, availableSeconds: 5 });
   expect(notices.map((notice) => notice.kind)).toEqual(["recording-starting", "recording-progress", "recording-progress", "recording-started"]);
   expect(notices.at(-1)?.detail).toBe("HASTE");
   expect(feedback.startingDetail).toBeUndefined();
});
it("confirms a start with nothing to capture as armed instead of leaving a spinner up", () => {
   const { feedback, notices, after, kinds } = fixture();
   feedback.starting("Automatic game detection");
   const nothing = { state: "waiting", sourceKind: "waiting", message: "Waiting for game" } as const;
   after(0, nothing);
   after(1000, nothing);
   expect(kinds()).toEqual(["recording-starting", "recording-progress"]);
   expect(feedback.startingDetail).toBe("Waiting for game");
   after(ARMED_AFTER_MS, nothing);
   expect(notices.at(-1)).toEqual({ kind: "recording-started", message: "Capture started", detail: "Waiting for game", error: false });
   expect(feedback.startingDetail).toBeUndefined();
   // Already told it is waiting, so no pause follows however long it waits.
   after(60_000, { state: "recording", sourceKind: "waiting", availableSeconds: 3 });
   expect(kinds().filter((kind) => kind === "recording-paused")).toHaveLength(0);
   after(1000, capturing);
   expect(notices.at(-1)).toEqual({ kind: "recording-source", message: "Now capturing", detail: "HASTE", error: false });
});
it("keeps the spinner while a selected game is still hooking, then confirms with it", () => {
   const { feedback, notices, after, kinds } = fixture();
   feedback.starting("HASTE");
   const hooking = { state: "waiting", sourceKind: "app", sourceName: "HASTE", message: "Waiting for an image from the selected source" } as const;
   after(0, hooking);
   after(4000, hooking);
   after(1000, capturing);
   expect(kinds()).toEqual(["recording-starting", "recording-progress", "recording-started"]);
   expect(notices.at(-1)?.detail).toBe("HASTE");
});
it("calls a selected source that never appears armed, without waiting forever", () => {
   const { feedback, notices, after } = fixture();
   feedback.starting("HASTE");
   const missing = { state: "waiting", sourceKind: "app", sourceName: "HASTE", message: "Waiting for application" } as const;
   after(0, missing);
   after(SOURCE_READY_MS - 1, missing);
   expect(notices.at(-1)?.kind).toBe("recording-progress");
   after(1, missing);
   expect(notices.at(-1)).toMatchObject({ kind: "recording-started", detail: "Waiting for application" });
});
it("announces a new source, but not an unchanged one", () => {
   const { feedback, notices, after, kinds } = fixture();
   feedback.starting("Automatic game detection");
   after(0, capturing);
   after(1000, { ...capturing, availableSeconds: 5 });
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
   after(1000, { ...capturing, sourceName: "Another game" });
   expect(notices.at(-1)).toMatchObject({ kind: "recording-source", detail: "Another game" });
   after(1000, { ...capturing, sourceName: "Another game", availableSeconds: 9 });
   expect(kinds().filter((kind) => kind === "recording-source")).toHaveLength(1);
});
it("ignores a quick switch away, like an alt-tab out of a fullscreen game", () => {
   const { feedback, after, kinds } = fixture();
   feedback.starting("HASTE");
   after(0, capturing);
   after(1000, { state: "waiting", message: "Waiting for application" });
   after(PAUSE_AFTER_MS - 1000, { state: "waiting", message: "Waiting for application" });
   after(1000, capturing);
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
});
it("reports a lasting pause once, then the same source coming back", () => {
   const { feedback, notices, after, kinds } = fixture();
   feedback.starting("HASTE");
   after(0, capturing);
   after(1000, { state: "waiting", message: "Waiting for application" });
   after(PAUSE_AFTER_MS, { state: "waiting", message: "Waiting for application" });
   after(1000, { state: "waiting", message: "Waiting for application" });
   expect(notices.at(-1)).toEqual({ kind: "recording-paused", message: "Capture paused", detail: "Waiting for application", error: false });
   expect(kinds().filter((kind) => kind === "recording-paused")).toHaveLength(1);
   after(1000, capturing);
   expect(notices.at(-1)).toEqual({ kind: "recording-resumed", message: "Now capturing", detail: "HASTE", error: false });
   after(1000, capturing);
   expect(kinds().filter((kind) => kind === "recording-resumed")).toHaveLength(1);
});
it("treats a crash while paused as a stopped capture, not a failed start", () => {
   const { feedback, notices, after } = fixture();
   feedback.starting("HASTE");
   after(0, capturing);
   after(PAUSE_AFTER_MS, { state: "waiting", message: "Waiting for application" });
   after(PAUSE_AFTER_MS, { state: "error", message: "Encoder disconnected" });
   expect(notices.at(-1)).toMatchObject({ kind: "critical-error", message: "Capture stopped unexpectedly" });
});
it("confirms intentional stops only after the recorder stops", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   state(capturing);
   feedback.stoppingRequested();
   expect(notices.at(-1)?.kind).toBe("recording-started");
   state({ state: "stopped" });
   state({ state: "stopped" });
   expect(notices.at(-1)).toEqual({ kind: "recording-stopped", message: "Capture stopped", detail: "HASTE", error: false });
   expect(notices.filter((notice) => notice.kind === "recording-stopped")).toHaveLength(1);
});
it("does not announce a successful start when a stop is already requested", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   feedback.stoppingRequested();
   state(capturing);
   state({ state: "stopped" });
   expect(notices.map((notice) => notice.kind)).toEqual(["recording-starting", "recording-stopped"]);
});
it("reports crashes once, separately from successful stops, and permits a retry", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   state(capturing);
   state({ state: "error", message: "Encoder disconnected" });
   state({ state: "error", message: "Encoder disconnected" });
   state({ state: "stopped" });
   feedback.startFailed("The recording helper exited during this action");
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Capture stopped unexpectedly", detail: "Encoder disconnected", error: true });
   expect(notices.filter((notice) => notice.error)).toHaveLength(1);
   expect(feedback.handledError("Encoder disconnected")).toBe(true);
   expect(feedback.handledError("The recording helper exited during this action")).toBe(true);
   feedback.starting("Screen 1");
   state(capturing);
   expect(notices.at(-1)?.kind).toBe("recording-started");
   expect(feedback.handledError("Encoder disconnected")).toBe(false);
});
it("reports startup failures without claiming recording started", () => {
   const { feedback, notices } = fixture();
   feedback.starting("Screen 1");
   feedback.startFailed("Microphone permission denied");
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Couldn't start capture", detail: "Microphone permission denied", error: true });
});
it("does not turn shutdown or an idle helper exit into a recording notification", () => {
   const { feedback, notices, state } = fixture();
   state({ state: "stopped" });
   state({ state: "error", message: "An idle audio query failed" });
   expect(notices).toHaveLength(0);
   feedback.starting("HASTE");
   state(capturing);
   feedback.state({ ...stoppedRecorder }, true);
   expect(notices.at(-1)?.kind).toBe("recording-started");
});
it("treats an unrequested stop as a failure", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   state(capturing);
   state({ state: "stopped" });
   expect(notices.at(-1)?.kind).toBe("critical-error");
});
it("keeps watching capture after a rejected stop", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   state(capturing);
   feedback.stoppingRequested();
   feedback.stopFailed();
   state({ state: "error", message: "Encoder failed" });
   expect(notices.at(-1)?.kind).toBe("critical-error");
});
