import { AlertCircle, Check, LoaderCircle, Monitor, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppState, CaptureSource } from "../../shared/types";
import { age, formatTime } from "./format";
import { api } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { useAudioWarning } from "./useAudioWarning";
import { IconButton } from "./ui";
import { clearAll, dismiss, setToastOpen, useNotifications, type NotificationEntry } from "./notifications";

/** How many chipped notifications show before the rest collapse into the log. */
const MAX_ICON_CHIPS = 4;

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
   const active = state?.recorder.state === "recording";
   const recorder = state?.recorder;
   const captured = sources.find(
      (source) => source.id === sourceId || (source.kind === "app" && sourceId?.startsWith("window:") && source.id.split(":")[1] === sourceId.split(":")[1])
   );
   const appIcon = captured?.appIcon || state?.applicationIcons[captured?.applicationId ?? ""];
   const isApplication = recorder?.sourceKind === "app";
   const audioWarning = useAudioWarning(recorder?.audioWarning || audioMessage);
   const status = active
      ? recorder?.message || "Capturing"
      : recorder?.state === "waiting"
        ? recorder?.message || "Waiting for application"
        : recorder?.state === "starting"
          ? "Starting capture"
          : recorder?.state === "error"
            ? "Capture stopped"
            : "Not capturing";
   const captureName =
      recorder?.sourceName || (state?.preferences.sourceKind === "screen" ? "Desktop" : state?.preferences.sourceKind === "auto" ? "Auto" : "Application");
   const { entries, openId } = useNotifications();
   const chips = entries.filter((entry) => entry.chip && !entry.toasted);
   const pendingSaves = recorder?.pendingSaves ?? 0;
   const hasShareableJob = !!state?.jobs.some((job) => job.kind === "shareable" && ["running", "queued"].includes(job.state));
   return (
      <footer className={`status-strip ${recorder?.state === "error" ? "has-error" : ""}`}>
         <div className="status-primary">
            {recorder?.state === "starting" || recorder?.state === "waiting" || !recorder ? (
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
                  <span className="status-secondary">
                     {isApplication ? <ApplicationIcon src={appIcon} size={14} /> : <Monitor size={14} />}
                     {captureName}
                  </span>
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
            {(audioWarning || state?.storageWarning || (recorder && !active && recorder.message && recorder.message !== status)) && (
               <div className="status-chips" role="list" aria-label="Warnings">
                  {audioWarning && (
                     <span className="status-chip condition error" role="listitem" title={audioWarning}>
                        <AlertCircle size={12} />
                        <span>{audioWarning}</span>
                     </span>
                  )}
                  {state?.storageWarning && (
                     <span className="status-chip condition warning" role="listitem" title={state.storageWarning}>
                        <AlertCircle size={12} />
                        <span>{state.storageWarning}</span>
                     </span>
                  )}
                  {recorder && !active && recorder.message && recorder.message !== status && (
                     <span className="status-chip condition error" role="listitem" title={recorder.message}>
                        <AlertCircle size={12} />
                        <span>{recorder.message}</span>
                     </span>
                  )}
               </div>
            )}
            <div className="status-chips" role="group" aria-label="Notifications">
               {chips
                  .slice(0, MAX_ICON_CHIPS - 1)
                  .reverse()
                  .map((entry) => (
                     <NotificationChip key={entry.id} entry={entry} iconOnly={entry !== chips[0]} />
                  ))}
               {chips.length >= MAX_ICON_CHIPS && <NotificationLog entries={chips} openId={openId} />}
            </div>
            {(pendingSaves > 0 || hasShareableJob) && (
               <div className="status-chips" role="list" aria-label="Activity">
                  {pendingSaves > 0 && (
                     <span className="status-chip progress" role="listitem">
                        <LoaderCircle size={12} className="spin" />
                        <span>Saving {pendingSaves > 1 ? `${pendingSaves} clips` : "clip"}</span>
                     </span>
                  )}
                  {hasShareableJob && (
                     <span className="status-chip progress" role="listitem">
                        <LoaderCircle size={12} className="spin" />
                        <span>Creating shareable</span>
                     </span>
                  )}
               </div>
            )}
         </div>
      </footer>
   );
}

/**
 * The newest chipped notification shows its text; older ones degrade to an
 * icon. Clicking either reopens the message as a pinned toast.
 */
function NotificationChip({ entry, iconOnly }: { entry: NotificationEntry; iconOnly: boolean }) {
   return (
      <button
         className={`status-chip ${entry.error ? "error" : "info"}${iconOnly ? " icon-only" : ""}`}
         title={entry.message}
         aria-label={`Notification: ${entry.message}`}
         onClick={() => setToastOpen(entry.id)}
      >
         {entry.error ? <AlertCircle size={12} /> : <Check size={12} />}
         {!iconOnly && <span>{entry.message}</span>}
      </button>
   );
}

/** Overflow popover listing chipped notifications with per-item dismiss. */
function NotificationLog({ entries, openId }: { entries: NotificationEntry[]; openId: number | null }) {
   const [open, setOpen] = useState(false);
   const root = useRef<HTMLDivElement>(null);
   useEffect(() => {
      if (!open) return;
      const close = (event: PointerEvent) => {
         if (!root.current?.contains(event.target as Node)) setOpen(false);
      };
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape") setOpen(false);
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", key);
      return () => {
         window.removeEventListener("pointerdown", close);
         window.removeEventListener("keydown", key);
      };
   }, [open]);
   return (
      <div className="notification-log" ref={root}>
         <button
            className={`status-chip icon-only ${openId !== null ? "open" : ""}`}
            aria-label={`Notification log, ${entries.length} notifications`}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
         >
            <span aria-hidden="true">…</span>
         </button>
         {open && (
            <div className="notification-log-popover" role="dialog" aria-label="Notification log">
               <div className="notification-log-entries">
                  {entries.map((entry) => (
                     <div key={entry.id} className="notification-log-row">
                        {entry.error ? <AlertCircle size={13} /> : <Check size={13} />}
                        <span title={entry.message}>{entry.message}</span>
                        <span className="notification-log-age">{age(entry.createdAt)}</span>
                        <IconButton label={`Dismiss: ${entry.message}`} onClick={() => dismiss(entry.id)}>
                           <X size={12} />
                        </IconButton>
                     </div>
                  ))}
               </div>
               <div className="notification-log-footer">
                  <span>
                     {entries.length} {entries.length === 1 ? "notification" : "notifications"}
                  </span>
                  <button className="notification-log-clear" onClick={() => clearAll()}>
                     Clear all
                  </button>
               </div>
            </div>
         )}
      </div>
   );
}
