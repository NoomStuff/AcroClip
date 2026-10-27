import { AlertCircle, LoaderCircle, Monitor } from "lucide-react";
import type { AppState } from "../../shared/types";
import { formatTime } from "./format";
import { reportFeedback } from "./desktop";

export function RecordingStatus({ state, elapsed, audioMessage = "" }: { state: AppState | null; elapsed: number; audioMessage?: string }) {
   const recorder = state?.recorder;
   const active = recorder?.state === "recording";
   const audioWarning = recorder?.audioWarning || audioMessage;
   const status = active
      ? recorder?.message || "Recording"
      : recorder?.state === "waiting"
        ? recorder?.message || "Waiting for application"
        : recorder?.state === "starting"
          ? "Starting recording"
          : recorder?.state === "error"
            ? "Recording stopped"
            : "Not recording";
   const captureName =
      recorder?.sourceName || (state?.preferences.sourceKind === "screen" ? "Screen" : state?.preferences.sourceKind === "auto" ? "Auto" : "Application");
   return (
      <footer className={`status-strip ${recorder?.state === "error" ? "has-error" : ""}`}>
         <div className="status-primary">
            {recorder?.state === "starting" ? (
               <LoaderCircle size={12} className="spin" />
            ) : recorder?.state === "error" ? (
               <AlertCircle size={13} />
            ) : (
               <span className={`status-dot ${active ? "recording" : ""}`} />
            )}
            <span className="status-summary" title={status}>
               {status}
            </span>
            {active && (
               <>
                  <span className="status-divider" />
                  <span className="tabular">{formatTime(elapsed)}</span>
                  <span className="status-secondary">{Math.floor(recorder.availableSeconds)}s available</span>
               </>
            )}
         </div>
         <div className="status-right">
            {audioWarning && (
               <button
                  className="status-audio"
                  title={audioWarning}
                  aria-label={`Audio status: ${audioWarning}`}
                  onClick={() => reportFeedback({ kind: "notice", message: audioWarning, error: true })}
               >
                  <AlertCircle size={13} />
                  Audio warning
               </button>
            )}
            {state?.storageWarning && (
               <span className="storage-warning" role="status" title={state.storageWarning}>
                  <AlertCircle size={13} />
                  {state.storageWarning}
               </span>
            )}
            {recorder && !active && recorder.message && recorder.message !== status && (
               <span className="status-message" title={recorder.message}>
                  {recorder.message}
               </span>
            )}
            {active && (
               <span className="status-secondary">
                  <Monitor size={12} />
                  {captureName}
               </span>
            )}
            {recorder && recorder.pendingSaves > 0 && (
               <span>
                  <LoaderCircle size={12} className="spin" />
                  Saving {recorder.pendingSaves > 1 ? `${recorder.pendingSaves} clips` : "clip"}
               </span>
            )}
            {state?.jobs.some((job) => job.kind === "shareable" && ["running", "queued"].includes(job.state)) && (
               <span>
                  <LoaderCircle size={12} className="spin" />
                  Creating shareable
               </span>
            )}
         </div>
      </footer>
   );
}
