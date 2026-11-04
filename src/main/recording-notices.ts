import type { RecorderState } from "../shared/types";

export type RecordingNoticeKind = "recording-starting" | "recording-started" | "recording-progress" | "recording-stopped" | "critical-error";
export interface RecordingNotice {
   kind: RecordingNoticeKind;
   message: string;
   detail: string;
   error: boolean;
}

/** One recording session, independent of source switches and status polling. */
export class RecordingNotices {
   private active = false;
   private confirmed = false;
   private stopping = false;
   private pendingText = "";
   private source = "";
   private readonly reportedErrors = new Set<string>();
   private readonly publish: (notice: RecordingNotice) => void;
   constructor(publish: (notice: RecordingNotice) => void) {
      this.publish = publish;
   }

   starting(source: string): void {
      this.active = true;
      this.confirmed = this.stopping = false;
      this.pendingText = source;
      this.source = source;
      this.reportedErrors.clear();
      this.emit("recording-starting", "Starting recording...");
   }

   get startingDetail(): string | undefined {
      return this.active && !this.confirmed && !this.stopping ? this.pendingText : undefined;
   }

   private progress(detail: string): void {
      if (detail === this.pendingText) return;
      this.pendingText = detail;
      this.emit("recording-progress", "Starting recording...", detail);
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
         this.fail(current.message || "The recording helper stopped unexpectedly.");
         return;
      }
      if (current.state === "stopped") {
         if (exiting) this.active = false;
         else if (this.stopping) {
            this.active = false;
            this.emit("recording-stopped", "Recording stopped");
         } else if (this.confirmed) this.fail("Capture stopped without a stop request.");
         return;
      }
      if (current.state === "recording" && current.availableSeconds > 0 && current.sourceKind !== "waiting" && current.sourceName)
         this.source = current.sourceName;
      if (this.stopping || this.confirmed) return;
      if (current.state === "waiting") {
         this.progress(current.message || "Waiting for source");
      } else if (current.state === "starting") {
         this.progress(current.message && current.message !== "Starting recording" ? current.message : "Preparing capture");
      } else if (current.state === "recording" && current.availableSeconds <= 0) {
         this.progress("Waiting for source");
      } else if (current.state === "recording" && current.availableSeconds > 0 && current.sourceKind !== "waiting") {
         this.confirmed = true;
         this.source = current.sourceName || this.source;
         this.emit("recording-started", "Recording started");
      }
   }

   private fail(message: string): void {
      this.active = false;
      this.reportedErrors.add(message);
      this.emit("critical-error", this.confirmed ? "Recording stopped unexpectedly" : "Couldn't start recording", message);
   }

   private emit(kind: RecordingNoticeKind, message: string, detail = this.source): void {
      this.publish({ kind, message, detail, error: kind === "critical-error" });
   }
}
