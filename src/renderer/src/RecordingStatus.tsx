import { AlertCircle, ChevronUp, LoaderCircle, Monitor, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppState, CaptureSource } from "../../shared/types";
import { age, formatTime } from "./format";
import { api } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { useAudioWarning } from "./useAudioWarning";
import { IconButton } from "./ui";
import { clearAll, dismiss, toggleOpen, useCondition, useNotifications, type NotificationEntry } from "./notifications";
import { NotificationIcon } from "./NotificationToast";

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
   const status =
      recorder && !recorder.supported
         ? "Capture unavailable"
         : active
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
   useCondition(
      "recorder",
      recorder && !recorder.supported
         ? { message: "Recorder unavailable", detail: recorder.message || "This build has no native recorder, so capture is off.", tone: "error" }
         : recorder && !active && recorder.message && recorder.message !== status
           ? { message: recorder.message, tone: "error" }
           : null
   );
   useCondition("audio", audioWarning ? { message: audioWarning, tone: "warning" } : null);
   useCondition("storage", state?.storageWarning ? { message: state.storageWarning, tone: "warning" } : null);
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
            <NotificationChips />
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

/** How many chips show before the rest only live in the log. */
const VISIBLE_CHIPS = 3;

/**
 * Chipped notifications and conditions, newest first. The newest shows its
 * title, older ones shrink to an icon, and the log lists all of them.
 */
function NotificationChips() {
   const { entries, open } = useNotifications();
   const chips = entries.filter((entry) => entry.chip && entry.phase !== "toast");
   if (!chips.length) return null;
   const shown = chips.slice(0, VISIBLE_CHIPS);
   const hidden = chips.slice(VISIBLE_CHIPS);
   return (
      <div className="status-chips" role="group" aria-label="Notifications">
         {chips.length > 1 && <NotificationLog entries={chips} hidden={hidden} />}
         {[...shown].reverse().map((entry) => (
            <NotificationChip key={entry.id} entry={entry} iconOnly={entry !== chips[0]} open={open?.id === entry.id && !open.closing} />
         ))}
      </div>
   );
}

function NotificationChip({ entry, iconOnly, open }: { entry: NotificationEntry; iconOnly: boolean; open: boolean }) {
   return (
      <button
         className={`status-chip ${entry.tone}${iconOnly ? " icon-only" : ""}${entry.phase === "collapsing" ? " arriving" : ""}`}
         data-notification-chip={entry.id}
         title={entry.detail ? `${entry.title}. ${entry.detail}` : entry.title}
         aria-label={`Notification: ${entry.title}`}
         aria-expanded={open}
         onClick={() => toggleOpen(entry.id)}
      >
         <NotificationIcon tone={entry.tone} size={12} />
         {!iconOnly && <span>{entry.title}</span>}
      </button>
   );
}

/** Popover listing every chipped notification, with per-item and bulk dismiss. */
function NotificationLog({ entries, hidden }: { entries: NotificationEntry[]; hidden: NotificationEntry[] }) {
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
            className={`status-chip log-toggle${open ? " open" : ""}`}
            data-notification-chip={hidden.map((entry) => entry.id).join(" ") || undefined}
            aria-label={`Notification log, ${entries.length} notifications`}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
         >
            <span className="tabular">{entries.length}</span>
            <ChevronUp size={12} />
         </button>
         {open && (
            <div className="notification-log-popover" role="dialog" aria-label="Notification log">
               <div className="notification-log-entries">
                  {entries.map((entry) => (
                     <div key={entry.id} className={`notification-log-row ${entry.tone}`}>
                        <NotificationIcon tone={entry.tone} size={13} />
                        <div className="notification-log-text">
                           <span>{entry.title}</span>
                           {entry.detail && <p>{entry.detail}</p>}
                        </div>
                        <span className="notification-log-age">{entry.key ? "Active" : age(entry.createdAt)}</span>
                        <IconButton label={`Dismiss: ${entry.title}`} onClick={() => dismiss(entry.id)}>
                           <X size={12} />
                        </IconButton>
                     </div>
                  ))}
               </div>
               <div className="notification-log-footer">
                  <span>
                     {entries.length} {entries.length === 1 ? "notification" : "notifications"}
                  </span>
                  <button
                     className="notification-log-clear"
                     onClick={() => {
                        clearAll();
                        setOpen(false);
                     }}
                  >
                     Clear all
                  </button>
               </div>
            </div>
         )}
      </div>
   );
}
