import type { RecorderState } from "../shared/types";

export type RecordingNoticeKind =
   | "recording-starting"
   | "recording-started"
   | "recording-progress"
   | "game-found"
   | "game-lost"
   | "recording-paused"
   | "recording-resumed"
   | "recording-stopped"
   | "critical-error";
export interface RecordingNotice {
   kind: RecordingNoticeKind;
   message: string;
   detail: string;
   error: boolean;
}
/** Auto follows games. App and screen capture follow the one source the user chose. */
export type CaptureMode = "auto" | "app" | "screen";

/**
 * How long the captured source must be gone before it counts as lost. Fullscreen
 * games minimize on alt-tab, and a quick switch away should not be reported.
 */
export const PAUSE_AFTER_MS = 3000;
/** How long a new session with nothing selected to capture, like Auto with no game, shows its spinner. */
export const ARMED_AFTER_MS = 1500;
/**
 * A selected source that isn't ready yet, such as a game capture still hooking, also reports
 * waiting. It usually starts within seconds, so the spinner holds longer before calling it armed.
 */
export const SOURCE_READY_MS = 10_000;

/** Capture is running but keeping nothing, such as Auto with no game or a closed application. */
const idle = (current: RecorderState) => current.state === "waiting" || (current.state === "recording" && current.sourceKind === "waiting");

/** One capture session, independent of status polling. */
export class RecordingNotices {
   private active = false;
   private confirmed = false;
   private stopping = false;
   /** Starts from AcroClip's own launch stay quiet unless something fails. */
   private quiet = false;
   private mode: CaptureMode = "screen";
   private pendingText = "";
   private source = "";
   /** What the user was last told is being captured: a game in Auto, the chosen source otherwise. Empty while it is missing. */
   private held = "";
   /** The chosen source has been captured at least once this session. */
   private seen = false;
   private idleSince: number | undefined;
   private lostSince: number | undefined;
   private readonly reportedErrors = new Set<string>();
   private readonly publish: (notice: RecordingNotice) => void;
   private readonly now: () => number;
   constructor(publish: (notice: RecordingNotice) => void, now: () => number = Date.now) {
      this.publish = publish;
      this.now = now;
   }

   starting(source: string, options: { mode: CaptureMode; quiet?: boolean }): void {
      this.active = true;
      this.confirmed = this.stopping = false;
      this.quiet = options.quiet === true;
      this.mode = options.mode;
      this.idleSince = this.lostSince = undefined;
      this.pendingText = source;
      this.source = source;
      this.held = "";
      this.seen = false;
      this.reportedErrors.clear();
      this.emit("recording-starting", "Starting capture...");
   }

   get startingDetail(): string | undefined {
      return this.active && !this.confirmed && !this.stopping ? this.pendingText : undefined;
   }

   private progress(detail: string): void {
      if (detail === this.pendingText) return;
      this.pendingText = detail;
      this.emit("recording-progress", "Starting capture...", detail);
   }

   stoppingRequested(): void {
      if (this.active) this.stopping = true;
   }

   stopFailed(): void {
      this.stopping = false;
   }

   startFailed(message: string): void {
      if (this.active) this.fail(message);
      else if (this.reportedErrors.size) this.reportedErrors.add(message);
   }

   get hasReportedError(): boolean {
      return this.reportedErrors.size > 0;
   }

   handledError(message: string): boolean {
      return this.reportedErrors.has(message);
   }

   state(current: RecorderState, exiting = false): void {
      if (!this.active) return;
      if (current.state === "error") {
         this.fail(current.message || "Start capturing again.");
         return;
      }
      if (current.state === "stopped") {
         if (exiting) this.active = false;
         else if (this.stopping) {
            this.active = false;
            this.emit("recording-stopped", "Capture stopped");
         } else if (this.confirmed) this.fail("Start capturing again.");
         return;
      }
      const name = current.sourceName ?? "";
      const footage = current.state === "recording" && current.availableSeconds > 0 && !idle(current) && name !== "";
      if (footage) this.source = name;
      if (this.stopping) return;
      // A game in Auto, or the chosen source otherwise. Auto's screen fallback is not a game.
      const target = idle(current) ? "" : this.mode === "auto" ? (footage && current.sourceKind === "app" ? name : "") : footage ? name : this.held;
      if (!this.confirmed) this.beforeConfirmed(current, footage, target);
      else this.follow(target);
   }

   private beforeConfirmed(current: RecorderState, footage: boolean, target: string): void {
      if (idle(current)) {
         this.idleSince ??= this.now();
         const reason = current.message || "Waiting for game";
         if (this.now() - this.idleSince < (current.sourceKind === "waiting" ? ARMED_AFTER_MS : SOURCE_READY_MS)) {
            this.progress(reason);
            return;
         }
         // The hotkey is answered: capture is on and keeps footage once a source appears.
         this.confirmed = true;
         this.emit("recording-started", "Capture started", reason);
         return;
      }
      this.idleSince = undefined;
      if (current.state === "starting") this.progress(current.message && current.message !== "Starting capture" ? current.message : "Preparing capture");
      else if (current.state === "recording" && current.availableSeconds <= 0) this.progress("Waiting for source");
      else if (footage) {
         this.confirmed = true;
         // A game already running when capture starts is part of "Capture started", not a separate find.
         this.held = target;
         this.seen = target !== "";
         this.emit("recording-started", "Capture started");
      }
   }

   private follow(target: string): void {
      if (target === this.held) {
         this.lostSince = undefined;
         return;
      }
      if (target === "") {
         this.lostSince ??= this.now();
         if (this.now() - this.lostSince < PAUSE_AFTER_MS) return;
         const lost = this.held;
         this.held = "";
         this.lostSince = undefined;
         if (this.mode === "auto") this.emit("game-lost", "Stopped capturing game", lost);
         else this.emit("recording-paused", "Capture paused", `Lost ${lost}. Capture resumes when it's back.`);
         return;
      }
      this.lostSince = undefined;
      this.held = target;
      const again = this.seen;
      this.seen = true;
      if (this.mode === "auto") this.emit("game-found", "Now capturing", target);
      else this.emit("recording-resumed", "Capture resumed", again ? `${target} was found again.` : `${target} was found.`);
   }

   private fail(message: string): void {
      this.active = false;
      this.reportedErrors.add(message);
      const title = this.confirmed ? "Capture stopped unexpectedly" : "Couldn't start capture";
      this.emit("critical-error", title, withoutTitle(message, title));
   }

   private emit(kind: RecordingNoticeKind, message: string, detail = this.source): void {
      if (this.quiet && (kind === "recording-starting" || kind === "recording-progress" || kind === "recording-started")) return;
      this.publish({ kind, message, detail, error: kind === "critical-error" });
   }
}

/** The banner already states what happened, so a detail that opens with the same sentence keeps only what follows. */
export function withoutTitle(message: string, title: string): string {
   const [first = "", ...rest] = message.split(/(?<=\.)\s+/);
   return first.replace(/\.$/, "").toLowerCase() === title.toLowerCase() ? rest.join(" ") : message;
}
