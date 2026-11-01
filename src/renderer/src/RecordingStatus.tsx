import { AlertCircle, LoaderCircle, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import type { AppState, CaptureSource } from "../../shared/types";
import { formatTime } from "./format";
import { api, reportFeedback } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";

export function RecordingStatus({ state, audioMessage = "" }: { state: AppState | null; visible: boolean; audioMessage?: string }) {
   const [sources, setSources] = useState<CaptureSource[]>([]);
   const sourceId = state?.recorder.sourceId;
   const applicationRecording = state?.recorder.state === "recording" && state.recorder.sourceKind === "app";
   useEffect(() => {
      if (!applicationRecording) return;
      let disposed = false;
      const unsubscribe = api.onEvent((event) => {
         if (event.type === "capture-sources") setSources(event.sources);
      });
      void api
         .sources()
         .then((value) => {
            if (!disposed) setSources(value);
         })
         .catch(() => undefined);
      return () => {
         disposed = true;
         unsubscribe();
      };
   }, [sourceId, applicationRecording]);
   const capacity = state?.preferences.clipSeconds ?? 60;
   const available = Math.max(0, Math.min(capacity, state?.recorder.availableSeconds ?? 0));
   const fill = capacity > 0 ? Math.min(1, available / capacity) : 0;
   const active = state?.recorder.state === "recording" && state.recorder.startingDetail === undefined;
   const recorder = state?.recorder;
   const captured = sources.find(
      (source) => source.id === sourceId || (source.kind === "app" && sourceId?.startsWith("window:") && source.id.split(":")[1] === sourceId.split(":")[1])
   );
   const appIcon = captured?.appIcon || state?.applicationIcons[captured?.applicationId ?? ""];
   const isApplication = recorder?.sourceKind === "app";
   const audioWarning = recorder?.audioWarning || audioMessage;
   const status =
      recorder?.startingDetail !== undefined
         ? "Starting recording..."
         : active
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
            {recorder?.startingDetail !== undefined || recorder?.state === "starting" || recorder?.state === "waiting" || !recorder ? (
               <LoaderCircle size={12} className="spin" />
            ) : recorder?.state === "error" ? (
               <AlertCircle size={13} />
            ) : (
               <span className={`status-dot ${active ? "recording" : ""}`} aria-hidden="true" />
            )}
            <span className="status-summary" title={status}>
               {status}
            </span>
            {active && (
               <>
                  <span className="status-divider" />
                  <svg
                     className={`buffer-ring${fill >= 1 ? " rolling" : ""}`}
                     style={{ animationDuration: `${Math.max(1, capacity) / 0.94}s` }}
                     viewBox="0 0 20 20"
                     role="img"
                     aria-label={`Buffer ${Math.round(fill * 100)}% full${fill >= 1 ? ", rolling" : ""}`}
                  >
                     <circle cx="10" cy="10" r="8" fill="none" stroke="var(--border-control)" strokeWidth="2" />
                     <circle
                        className="buffer-ring-fill"
                        cx="10"
                        cy="10"
                        r="8"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2"
                        strokeOpacity={fill > 0 ? 1 : 0}
                        strokeLinecap="round"
                        pathLength="100"
                        strokeDasharray="94 100"
                        strokeDashoffset={94 * (1 - fill)}
                     />
                  </svg>
                  <span className="tabular">{formatTime(available)} available</span>
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
            {recorder?.startingDetail !== undefined ? (
               <span className="status-message" title={recorder.startingDetail}>
                  {recorder.startingDetail}
               </span>
            ) : (
               recorder &&
               !active &&
               recorder.message &&
               recorder.message !== status && (
                  <span className="status-message" title={recorder.message}>
                     {recorder.message}
                  </span>
               )
            )}
            {active && (
               <span className="status-secondary">
                  {isApplication ? <ApplicationIcon src={appIcon} size={14} /> : <Monitor size={14} />}
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
