import { expect, it } from "vitest";
import { stoppedRecorder } from "../shared/defaults";
import { ARMED_AFTER_MS, PAUSE_AFTER_MS, RecordingNotices, SOURCE_READY_MS, type CaptureMode, type RecordingNotice } from "./recording-notices";
import type { RecorderState } from "../shared/types";

function fixture(sourceClosed = () => false) {
   const notices: RecordingNotice[] = [];
   let clock = 0;
   const feedback = new RecordingNotices(
      (notice) => notices.push(notice),
      () => clock,
      sourceClosed
   );
   const state = (changes: Partial<RecorderState>) => feedback.state({ ...stoppedRecorder, ...changes });
   /** Status arrives about once a second, so time passes between polls. */
   const after = (ms: number, changes: Partial<RecorderState>) => {
      clock += ms;
      state(changes);
   };
   const kinds = () => notices.map((notice) => notice.kind);
   const start = (source: string, mode: CaptureMode = "app", quiet = false) => feedback.starting(source, { mode, quiet });
   return { notices, feedback, state, after, kinds, start };
}
const capturing = { state: "recording", availableSeconds: 1, sourceKind: "app", sourceName: "HASTE" } as const;
const noGame = { state: "waiting", sourceKind: "waiting", message: "Waiting for game" } as const;
const lostApp = { state: "waiting", sourceKind: "app", sourceName: "HASTE", message: "Waiting for application" } as const;

it("acknowledges a start immediately, then confirms usable footage once", () => {
   const { feedback, notices, state, kinds, start } = fixture();
   start("Screen 1");
   expect(notices).toEqual([{ kind: "recording-starting", message: "Starting capture...", detail: "Screen 1", error: false }]);
   state({ state: "starting" });
   state({ ...capturing, availableSeconds: 0 });
   expect(notices).toHaveLength(3);
   expect(feedback.startingDetail).toBe("Waiting for source");
   state(capturing);
   state({ ...capturing, availableSeconds: 5 });
   expect(kinds()).toEqual(["recording-starting", "recording-progress", "recording-progress", "recording-started"]);
   expect(notices.at(-1)?.detail).toBe("HASTE");
   expect(feedback.startingDetail).toBeUndefined();
});
it("stays quiet when AcroClip starts capture itself, but still reports what follows", () => {
   const { notices, after, kinds, start } = fixture();
   start("Automatic game detection", "auto", true);
   after(0, noGame);
   after(ARMED_AFTER_MS, noGame);
   expect(notices).toHaveLength(0);
   after(1000, capturing);
   expect(kinds()).toEqual(["game-found"]);
});
it("still reports a failed quiet start", () => {
   const { feedback, notices, start } = fixture();
   start("HASTE", "app", true);
   feedback.startFailed("Microphone permission denied");
   expect(notices).toEqual([{ kind: "critical-error", message: "Couldn't start capture", detail: "Microphone permission denied", error: true }]);
});

it("confirms an Auto start with no game as armed, then announces the game it finds", () => {
   const { feedback, notices, after, kinds, start } = fixture();
   start("Automatic game detection", "auto");
   after(0, noGame);
   after(1000, noGame);
   expect(kinds()).toEqual(["recording-starting", "recording-progress"]);
   after(ARMED_AFTER_MS, noGame);
   expect(notices.at(-1)).toEqual({ kind: "recording-started", message: "Capture started", detail: "Waiting for game", error: false });
   expect(feedback.startingDetail).toBeUndefined();
   after(60_000, noGame);
   expect(kinds()).not.toContain("game-lost");
   after(1000, capturing);
   expect(notices.at(-1)).toEqual({ kind: "game-found", message: "Now capturing", detail: "HASTE", error: false });
});
it("does not announce a game that was already running when Auto started", () => {
   const { after, kinds, start } = fixture();
   start("Automatic game detection", "auto");
   after(0, capturing);
   after(1000, { ...capturing, availableSeconds: 5 });
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
});
it("reports a closed game, then the next game Auto finds", () => {
   const { notices, after, kinds, start } = fixture();
   start("Automatic game detection", "auto");
   after(0, capturing);
   after(1000, noGame);
   after(PAUSE_AFTER_MS, noGame);
   expect(notices.at(-1)).toEqual({ kind: "game-lost", message: "Stopped capturing game", detail: "HASTE", error: false });
   after(1000, noGame);
   expect(kinds().filter((kind) => kind === "game-lost")).toHaveLength(1);
   after(1000, { ...capturing, sourceName: "Another game" });
   expect(notices.at(-1)).toEqual({ kind: "game-found", message: "Now capturing", detail: "Another game", error: false });
});
it("announces switching straight to another game", () => {
   const { notices, after, start } = fixture();
   start("Automatic game detection", "auto");
   after(0, capturing);
   after(1000, { ...capturing, sourceName: "Another game" });
   expect(notices.at(-1)).toMatchObject({ kind: "game-found", detail: "Another game" });
});
it("does not treat Auto's screen fallback as a game", () => {
   const { notices, after, kinds, start } = fixture();
   start("Automatic game detection", "auto");
   const desktop = { state: "recording", availableSeconds: 1, sourceKind: "screen", sourceName: "Desktop" } as const;
   after(0, desktop);
   expect(notices.at(-1)).toMatchObject({ kind: "recording-started", detail: "Desktop" });
   after(1000, capturing);
   expect(notices.at(-1)).toMatchObject({ kind: "game-found", detail: "HASTE" });
   after(1000, desktop);
   after(PAUSE_AFTER_MS, desktop);
   expect(notices.at(-1)).toMatchObject({ kind: "game-lost", detail: "HASTE" });
   expect(kinds().filter((kind) => kind === "game-found")).toHaveLength(1);
});

it("ignores a quick switch away, like an alt-tab out of a fullscreen game", () => {
   for (const mode of ["auto", "app"] as const) {
      const { after, kinds, start } = fixture();
      start("HASTE", mode);
      after(0, capturing);
      after(1000, mode === "auto" ? noGame : lostApp);
      after(PAUSE_AFTER_MS - 1000, mode === "auto" ? noGame : lostApp);
      after(1000, capturing);
      expect(kinds()).toEqual(["recording-starting", "recording-started"]);
   }
});
it("pauses when the chosen application is lost, and resumes when it is found again", () => {
   const { notices, after, kinds, start } = fixture();
   start("HASTE", "app");
   after(0, capturing);
   after(1000, lostApp);
   after(PAUSE_AFTER_MS, lostApp);
   after(1000, lostApp);
   expect(notices.at(-1)).toEqual({ kind: "recording-paused", message: "Capture paused", detail: "Lost HASTE. Capture resumes when it's back.", error: false });
   expect(kinds().filter((kind) => kind === "recording-paused")).toHaveLength(1);
   after(1000, capturing);
   expect(notices.at(-1)).toEqual({ kind: "recording-resumed", message: "Capture resumed", detail: "HASTE was found again.", error: false });
   after(1000, capturing);
   expect(kinds().filter((kind) => kind === "recording-resumed")).toHaveLength(1);
});
it("keeps the spinner while a chosen game is still hooking, then confirms with it", () => {
   const { notices, after, kinds, start } = fixture();
   start("HASTE");
   const hooking = { ...lostApp, message: "Waiting for an image from the selected source" };
   after(0, hooking);
   after(4000, hooking);
   after(1000, capturing);
   expect(kinds()).toEqual(["recording-starting", "recording-progress", "recording-started"]);
   expect(notices.at(-1)?.detail).toBe("HASTE");
});
it("calls a chosen application that never appears armed, then says when it is found", () => {
   const { notices, after, start } = fixture();
   start("HASTE");
   after(0, lostApp);
   after(SOURCE_READY_MS - 1, lostApp);
   expect(notices.at(-1)?.kind).toBe("recording-progress");
   after(1, lostApp);
   expect(notices.at(-1)).toMatchObject({ kind: "recording-started", detail: "Waiting for application" });
   after(1000, capturing);
   expect(notices.at(-1)).toMatchObject({ kind: "recording-resumed", detail: "HASTE was found." });
});
it("treats a crash while paused as a stopped capture, not a failed start", () => {
   const { notices, after, start } = fixture();
   start("HASTE");
   after(0, capturing);
   after(PAUSE_AFTER_MS, lostApp);
   after(PAUSE_AFTER_MS, { state: "error", message: "Encoder disconnected" });
   expect(notices.at(-1)).toMatchObject({ kind: "critical-error", message: "Capture stopped unexpectedly" });
});

it("treats switching source as a move, not a find or a loss", () => {
   const { feedback, notices, after, kinds, start } = fixture();
   start("HASTE", "app");
   after(0, capturing);
   feedback.switching("app");
   // Status during the switch still describes the old source, or nothing at all.
   after(1000, capturing);
   after(PAUSE_AFTER_MS, lostApp);
   feedback.switched();
   after(1000, { ...capturing, sourceName: "Other app" });
   after(1000, { ...capturing, sourceName: "Other app" });
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
   after(1000, { ...lostApp, sourceName: "Other app" });
   after(PAUSE_AFTER_MS, { ...lostApp, sourceName: "Other app" });
   expect(notices.at(-1)).toMatchObject({ kind: "recording-paused", detail: "Lost Other app. Capture resumes when it's back." });
});
it("adopts a switched application through its waiting and empty-buffer statuses", () => {
   // The status sequence a Linux XWayland switch reports, recorded live on Hyprland.
   const { feedback, notices, after, kinds, start } = fixture();
   start("Starfall", "app");
   after(0, { ...capturing, sourceName: "Starfall" });
   feedback.switching("app");
   after(1000, { ...capturing, sourceName: "Starfall", availableSeconds: 5 });
   feedback.switched();
   after(100, { ...lostApp, sourceName: "Moonrise" });
   after(600, { ...capturing, sourceName: "Moonrise", availableSeconds: 0 });
   after(800, { ...capturing, sourceName: "Moonrise", availableSeconds: 0 });
   after(200, { ...capturing, sourceName: "Moonrise", availableSeconds: 0.04 });
   after(5000, { ...capturing, sourceName: "Moonrise", availableSeconds: 5 });
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
   after(1000, { ...lostApp, sourceName: "Moonrise" });
   after(PAUSE_AFTER_MS, { ...lostApp, sourceName: "Moonrise" });
   expect(notices.at(-1)).toMatchObject({ kind: "recording-paused", detail: "Lost Moonrise. Capture resumes when it's back." });
});
it("never repeats the title as the error detail", () => {
   const { notices, after, start } = fixture();
   start("Starfall", "app");
   after(0, { ...capturing, sourceName: "Starfall" });
   after(1000, { state: "error", message: "Capture stopped unexpectedly" });
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Capture stopped unexpectedly", detail: "Start capturing again.", error: true });
   start("Starfall", "app");
   after(0, { state: "error", message: "Couldn't start capture." });
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Couldn't start capture", detail: "Try again.", error: true });
});
it("says to choose a closed application again where capture cannot follow it", () => {
   let closed = false;
   const { notices, after, start } = fixture(() => closed);
   start("Starfall", "app");
   after(0, { ...capturing, sourceName: "Starfall" });
   after(1000, { ...lostApp, sourceName: "Starfall" });
   after(PAUSE_AFTER_MS, { ...lostApp, sourceName: "Starfall" });
   expect(notices.at(-1)).toMatchObject({ kind: "recording-paused", detail: "Lost Starfall. Capture resumes when it's back." });
   after(1000, { ...capturing, sourceName: "Starfall" });
   closed = true;
   after(1000, { ...lostApp, sourceName: "Starfall" });
   after(PAUSE_AFTER_MS, { ...lostApp, sourceName: "Starfall" });
   expect(notices.at(-1)).toMatchObject({ kind: "recording-paused", detail: "Starfall closed. Reopen it and choose it again." });
});
it("does not announce the game that is running when switching to Auto", () => {
   const { feedback, after, kinds, start } = fixture();
   start("Screen 1", "screen");
   after(0, { ...capturing, sourceKind: "screen", sourceName: "Screen 1" });
   feedback.switching("auto");
   feedback.switched();
   after(1000, capturing);
   after(1000, capturing);
   expect(kinds()).toEqual(["recording-starting", "recording-started"]);
});
it("announces a game found after switching to Auto with none running", () => {
   const { feedback, notices, after, start } = fixture();
   start("Screen 1", "screen");
   after(0, { ...capturing, sourceKind: "screen", sourceName: "Screen 1" });
   feedback.switching("auto");
   feedback.switched();
   after(0, noGame);
   after(ARMED_AFTER_MS, noGame);
   after(5000, noGame);
   expect(notices.at(-1)?.kind).toBe("recording-started");
   after(1000, capturing);
   expect(notices.at(-1)).toMatchObject({ kind: "game-found", detail: "HASTE" });
});
it("keeps notices working after a switch fails", () => {
   const { feedback, notices, after, start } = fixture();
   start("HASTE", "app");
   after(0, capturing);
   feedback.switching("app");
   feedback.switched();
   after(1000, capturing);
   after(1000, lostApp);
   after(PAUSE_AFTER_MS, lostApp);
   expect(notices.at(-1)?.kind).toBe("recording-paused");
});

it("confirms intentional stops only after the recorder stops", () => {
   const { feedback, notices, state, start } = fixture();
   start("HASTE");
   state(capturing);
   feedback.stoppingRequested();
   expect(notices.at(-1)?.kind).toBe("recording-started");
   state({ state: "stopped" });
   state({ state: "stopped" });
   expect(notices.at(-1)).toEqual({ kind: "recording-stopped", message: "Capture stopped", detail: "HASTE", error: false });
   expect(notices.filter((notice) => notice.kind === "recording-stopped")).toHaveLength(1);
});
it("does not announce a successful start when a stop is already requested", () => {
   const { feedback, state, kinds, start } = fixture();
   start("HASTE");
   feedback.stoppingRequested();
   state(capturing);
   state({ state: "stopped" });
   expect(kinds()).toEqual(["recording-starting", "recording-stopped"]);
});
it("reports crashes once, separately from successful stops, and permits a retry", () => {
   const { feedback, notices, state, start } = fixture();
   start("HASTE");
   state(capturing);
   state({ state: "error", message: "Encoder disconnected" });
   state({ state: "error", message: "Encoder disconnected" });
   state({ state: "stopped" });
   feedback.startFailed("The recording helper exited during this action");
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Capture stopped unexpectedly", detail: "Encoder disconnected", error: true });
   expect(notices.filter((notice) => notice.error)).toHaveLength(1);
   expect(feedback.handledError("Encoder disconnected")).toBe(true);
   expect(feedback.handledError("The recording helper exited during this action")).toBe(true);
   start("Screen 1");
   state(capturing);
   expect(notices.at(-1)?.kind).toBe("recording-started");
   expect(feedback.handledError("Encoder disconnected")).toBe(false);
});
it("reports startup failures without claiming capture started", () => {
   const { feedback, notices, start } = fixture();
   start("Screen 1");
   feedback.startFailed("Microphone permission denied");
   expect(notices.at(-1)).toEqual({ kind: "critical-error", message: "Couldn't start capture", detail: "Microphone permission denied", error: true });
});
it("does not turn shutdown or an idle helper exit into a capture notification", () => {
   const { feedback, notices, state, start } = fixture();
   state({ state: "stopped" });
   state({ state: "error", message: "An idle audio query failed" });
   expect(notices).toHaveLength(0);
   start("HASTE");
   state(capturing);
   feedback.state({ ...stoppedRecorder }, true);
   expect(notices.at(-1)?.kind).toBe("recording-started");
});
it("treats an unrequested stop as a failure", () => {
   const { notices, state, start } = fixture();
   start("HASTE");
   state(capturing);
   state({ state: "stopped" });
   expect(notices.at(-1)?.kind).toBe("critical-error");
});
it("keeps watching capture after a rejected stop", () => {
   const { feedback, notices, state, start } = fixture();
   start("HASTE");
   state(capturing);
   feedback.stoppingRequested();
   feedback.stopFailed();
   state({ state: "error", message: "Encoder failed" });
   expect(notices.at(-1)?.kind).toBe("critical-error");
});
