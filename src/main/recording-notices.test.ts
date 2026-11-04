import { expect, it } from "vitest";
import { stoppedRecorder } from "../shared/defaults";
import { RecordingNotices, type RecordingNotice } from "./recording-notices";
import type { RecorderState } from "../shared/types";

function fixture() {
   const notices: RecordingNotice[] = [];
   const feedback = new RecordingNotices((notice) => notices.push(notice));
   const state = (changes: Partial<RecorderState>) => feedback.state({ ...stoppedRecorder, ...changes });
   return { notices, feedback, state };
}
const capturing = { state: "recording", availableSeconds: 1, sourceKind: "app", sourceName: "HASTE" } as const;
it("acknowledges a start immediately, then confirms usable footage once", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("Screen 1");
   expect(notices).toEqual([{ kind: "recording-starting", message: "Starting recording...", detail: "Screen 1", error: false }]);
   state({ state: "starting" });
   state({ ...capturing, availableSeconds: 0 });
   expect(notices).toHaveLength(3);
   expect(notices.every((notice) => notice.message === "Starting recording...")).toBe(true);
   expect(feedback.startingDetail).toBe("Waiting for source");
   state(capturing);
   state({ ...capturing, availableSeconds: 5 });
   expect(notices.map((notice) => notice.kind)).toEqual(["recording-starting", "recording-progress", "recording-progress", "recording-started"]);
   expect(notices.at(-1)?.detail).toBe("HASTE");
   expect(feedback.startingDetail).toBeUndefined();
});
it("distinguishes waiting for a game from recording and suppresses routine source changes", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("Automatic game detection");
   state({ state: "waiting", message: "Waiting for game" });
   state({ state: "waiting", message: "Waiting for game" });
   state({ state: "recording", sourceKind: "waiting", availableSeconds: 3 });
   expect(notices.map((notice) => notice.kind)).toEqual(["recording-starting", "recording-progress"]);
   state(capturing);
   state({ state: "waiting" });
   state({ ...capturing, sourceName: "Another game" });
   expect(notices.filter((notice) => notice.kind === "recording-started")).toHaveLength(1);
});
it("confirms intentional stops only after the recorder stops", () => {
   const { feedback, notices, state } = fixture();
   feedback.starting("HASTE");
   state(capturing);
   feedback.stoppingRequested();
   expect(notices.at(-1)?.kind).toBe("recording-started");
   state({ state: "stopped" });
   state({ state: "stopped" });
   expect(notices.at(-1)).toEqual({ kind: "recording-stopped", message: "Recording stopped", detail: "HASTE", error: false });
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
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Recording stopped unexpectedly", detail: "Encoder disconnected", error: true });
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
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Couldn't start recording", detail: "Microphone permission denied", error: true });
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
