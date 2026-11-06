import { AlertCircle, LoaderCircle, Monitor, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppState, CaptureSource } from "../../shared/types";
import { age, formatTime } from "./format";
import { api } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { useAudioWarning } from "./useAudioWarning";
import { IconButton } from "./ui";
import { clearAll, closeOpen, dismiss, toggleOpen, useCondition, useNotifications, type NotificationEntry } from "./notifications";
import { closePinned } from "./notification-motion";
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
         ? { message: "Recorder unavailable", detail: "Reinstall AcroClip to capture clips.", tone: "error" }
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

/**
 * One pill for every chipped notification and condition. It shows the newest
 * title; clicking it reopens that message, and the count opens the log.
 */
function NotificationChips() {
   const { entries, open } = useNotifications();
   const chips = entries.filter((entry) => entry.chip && entry.phase === "chip");
   const [logOpen, setLogOpen] = useState(false);
   const closeLog = useCallback(() => setLogOpen(false), []);
   const pill = useRef<HTMLDivElement>(null);
   const width = useRef(0);
   const newest = chips[0];
   // The pill eases to its new width when the title changes, instead of jumping.
   useLayoutEffect(() => {
      const element = pill.current;
      if (!element) {
         width.current = 0;
         return;
      }
      const next = element.getBoundingClientRect().width;
      if (width.current && Math.abs(width.current - next) > 1 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
         element.animate([{ width: `${width.current}px` }, { width: `${next}px` }], { duration: 380, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      width.current = next;
   }, [newest?.id, newest?.title, chips.length]);
   useEffect(() => {
      if (chips.length < 2) setLogOpen(false);
   }, [chips.length]);
   if (!newest) return null;
   const opened = open === newest.id;
   return (
      <div className="notification-area">
         <div ref={pill} className={`notification-pill ${newest.tone}`} data-notification-chip={chips.map((entry) => entry.id).join(" ")}>
            <button
               className="notification-pill-main"
               title={newest.detail ? `${newest.title}. ${newest.detail}` : newest.title}
               aria-label={`Notification: ${newest.title}`}
               aria-expanded={opened}
               onClick={() => (opened ? closePinned(newest.id, closeOpen) : toggleOpen(newest.id))}
            >
               <NotificationIcon tone={newest.tone} size={12} />
               <span>{newest.title}</span>
            </button>
            {chips.length > 1 && (
               <button
                  className="notification-pill-count"
                  aria-label={`Notification log, ${chips.length} notifications`}
                  aria-expanded={logOpen}
                  onClick={() => setLogOpen((value) => !value)}
               >
                  <span key={chips.length} className="tabular">
                     +{chips.length - 1}
                  </span>
               </button>
            )}
         </div>
         {logOpen && <NotificationLog entries={chips} open={open} close={closeLog} />}
      </div>
   );
}

/** Every chipped notification. A row reopens its message; dismiss removes it. */
function NotificationLog({ entries, open, close }: { entries: NotificationEntry[]; open: number | null; close: () => void }) {
   const root = useRef<HTMLDivElement>(null);
   useEffect(() => {
      const outside = (event: PointerEvent) => {
         const target = event.target as Element;
         if (!root.current?.contains(target) && !target.closest?.(".notification-pill-count")) close();
      };
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape") close();
      };
      window.addEventListener("pointerdown", outside);
      window.addEventListener("keydown", key);
      return () => {
         window.removeEventListener("pointerdown", outside);
         window.removeEventListener("keydown", key);
      };
   }, [close]);
   return (
      <div className="notification-log-popover" role="dialog" aria-label="Notification log" ref={root}>
         <div className="notification-log-entries">
            {entries.map((entry) => (
               <div key={entry.id} className={`notification-log-row ${entry.tone}`}>
                  <NotificationIcon tone={entry.tone} size={13} />
                  <button
                     className="notification-log-text"
                     onClick={() => {
                        close();
                        if (open !== entry.id) toggleOpen(entry.id);
                     }}
                  >
                     <span>{entry.title}</span>
                     {entry.detail && <p>{entry.detail}</p>}
                  </button>
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
                  close();
               }}
            >
               Clear all
            </button>
         </div>
      </div>
   );
}
