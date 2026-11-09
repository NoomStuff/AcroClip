import type { RecorderState } from "../shared/types";

export type RecordingNoticeKind =
   "recording-starting" | "recording-started" | "recording-progress" | "recording-waiting" | "recording-stopped" | "critical-error";
export interface RecordingNotice {
   kind: RecordingNoticeKind;
   message: string;
   detail: string;
   error: boolean;
}

/** One capture session, independent of source switches and status polling. */
export class RecordingNotices {
   private active = false;
   private confirmed = false;
   private stopping = false;
   private waiting = false;
   private pendingText = "";
   private source = "";
   private readonly reportedErrors = new Set<string>();
   private readonly publish: (notice: RecordingNotice) => void;
   constructor(publish: (notice: RecordingNotice) => void) {
      this.publish = publish;
   }

   starting(source: string): void {
      this.active = true;
      this.confirmed = this.stopping = this.waiting = false;
      this.pendingText = source;
      this.source = source;
      this.reportedErrors.clear();
      this.emit("recording-starting", "Starting capture...");
   }

   get startingDetail(): string | undefined {
      return this.active && !this.confirmed && !this.stopping ? this.pendingText : undefined;
   }

   private progress(detail: string): void {
      this.waiting = false;
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
      if (current.state === "recording" && current.availableSeconds > 0 && current.sourceKind !== "waiting" && current.sourceName)
         this.source = current.sourceName;
      if (this.stopping || this.confirmed) return;
      if (current.state === "waiting") {
         // Capture is armed but has nothing to keep yet, possibly for a long time. A spinner would sit on screen
         // until a game opens, so this banner finishes, and "Capture started" follows once footage flows.
         if (this.waiting) return;
         this.waiting = true;
         this.pendingText = current.message || "Waiting for game";
         this.emit("recording-waiting", this.pendingText);
      } else if (current.state === "starting") {
         this.progress(current.message && current.message !== "Starting capture" ? current.message : "Preparing capture");
      } else if (current.state === "recording" && current.availableSeconds <= 0) {
         this.progress("Waiting for source");
      } else if (current.state === "recording" && current.availableSeconds > 0 && current.sourceKind !== "waiting") {
         this.confirmed = true;
         this.source = current.sourceName || this.source;
         this.emit("recording-started", "Capture started");
      }
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
