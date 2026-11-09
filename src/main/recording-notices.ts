import type { RecorderState } from "../shared/types";

export type RecordingNoticeKind =
   | "recording-starting"
   | "recording-started"
   | "recording-progress"
   | "recording-source"
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

/**
 * How long capture must have nothing to keep before it counts as paused. Fullscreen
 * games minimize on alt-tab, and a quick switch away should not be a pause.
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
   private pendingText = "";
   private source = "";
   /** The source the user was last told about. Empty while armed without one. */
   private announced = "";
   private idleSince: number | undefined;
   private pauseReported = false;
   private readonly reportedErrors = new Set<string>();
   private readonly publish: (notice: RecordingNotice) => void;
   private readonly now: () => number;
   constructor(publish: (notice: RecordingNotice) => void, now: () => number = Date.now) {
      this.publish = publish;
      this.now = now;
   }

   starting(source: string): void {
      this.active = true;
      this.confirmed = this.stopping = this.pauseReported = false;
      this.idleSince = undefined;
      this.pendingText = source;
      this.source = source;
      this.announced = "";
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
      if (idle(current)) {
         this.idleSince ??= this.now();
         this.idleFor(this.now() - this.idleSince, current.message || "Waiting for game", current.sourceKind === "waiting" ? ARMED_AFTER_MS : SOURCE_READY_MS);
         return;
      }
      this.idleSince = undefined;
      if (!this.confirmed) {
         if (current.state === "starting") this.progress(current.message && current.message !== "Starting capture" ? current.message : "Preparing capture");
         else if (current.state === "recording" && current.availableSeconds <= 0) this.progress("Waiting for source");
         else if (footage) {
            this.confirmed = true;
            this.announced = name;
            this.emit("recording-started", "Capture started");
         }
         return;
      }
      if (!footage) return;
      const resumed = this.pauseReported;
      this.pauseReported = false;
      if (name !== this.announced) {
         this.announced = name;
         this.emit("recording-source", "Now capturing", name);
      } else if (resumed) this.emit("recording-resumed", "Now capturing", name);
   }

   private idleFor(elapsed: number, reason: string, armedAfter: number): void {
      if (!this.confirmed) {
         if (elapsed < armedAfter) {
            this.progress(reason);
            return;
         }
         // The hotkey is answered. Capture is on and will keep footage once a source appears,
         // which "Now capturing" announces. The user already knows it is waiting, so no pause follows.
         this.confirmed = this.pauseReported = true;
         this.emit("recording-started", "Capture started", reason);
         return;
      }
      if (this.pauseReported || elapsed < PAUSE_AFTER_MS) return;
      this.pauseReported = true;
      this.emit("recording-paused", "Capture paused", reason);
   }

   private fail(message: string): void {
      this.active = false;
      this.reportedErrors.add(message);
      const title = this.confirmed ? "Capture stopped unexpectedly" : "Couldn't start capture";
      this.emit("critical-error", title, withoutTitle(message, title));
   }

   private emit(kind: RecordingNoticeKind, message: string, detail = this.source): void {
      this.publish({ kind, message, detail, error: kind === "critical-error" });
   }
}

/** The banner already states what happened, so a detail that opens with the same sentence keeps only what follows. */
export function withoutTitle(message: string, title: string): string {
   const [first = "", ...rest] = message.split(/(?<=\.)\s+/);
   return first.replace(/\.$/, "").toLowerCase() === title.toLowerCase() ? rest.join(" ") : message;
}
