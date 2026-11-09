import { Popover } from "./Popover";
import { AlertCircle, ChevronDown, LoaderCircle, Monitor, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppState, CaptureSource } from "../../shared/types";
import { age, formatTime } from "./format";
import { api } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { useAudioWarning } from "./useAudioWarning";
import { IconButton } from "./ui";
import {
   chipGroups,
   clearAll,
   closeOpen,
   dismiss,
   toggleOpen,
   useCondition,
   useNotifications,
   type NotificationEntry,
   type NotificationTone,
} from "./notifications";
import { closePinned, glide, pillTargets, popIn, sweepOut } from "./notification-motion";
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
   const active = state?.recorder.state === "recording" && state.recorder.startingDetail === undefined;
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
             : recorder?.state === "starting" || recorder?.startingDetail !== undefined
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
   useCondition("history", active && recorder?.historyWarning ? { message: recorder.historyWarning, tone: "warning" } : null);
   useCondition("storage", state?.storageWarning ? { message: state.storageWarning, tone: "warning" } : null);
   const pendingSaves = recorder?.pendingSaves ?? 0;
   const hasShareableJob = !!state?.jobs.some((job) => job.kind === "shareable" && ["running", "queued"].includes(job.state));
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
            <span className="status-summary" data-tooltip={status} data-tooltip-overflow="">
               {status}
            </span>
            {recorder?.startingDetail && recorder.startingDetail !== status && (
               <>
                  <span className="status-divider" />
                  <span className="status-secondary" data-tooltip={recorder.startingDetail} data-tooltip-overflow="">
                     {recorder.startingDetail}
                  </span>
               </>
            )}
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

const toneNames: Record<NotificationTone, [string, string]> = {
   error: ["error", "errors"],
   warning: ["warning", "warnings"],
   success: ["message", "messages"],
};
const countLabel = (tone: NotificationTone, count: number) => `${count} ${toneNames[tone][count === 1 ? 0 : 1]}`;

/**
 * Chips grouped into one pill per tone. The most severe group sits on the
 * right with its newest title, so an error is never hidden behind a success.
 * The other groups shrink to an icon and count.
 */
function NotificationChips() {
   const { entries, open } = useNotifications();
   const groups = chipGroups(entries);
   const [logOpen, setLogOpen] = useState(false);
   const closeLog = useCallback(() => setLogOpen(false), []);
   const area = useRef<HTMLDivElement>(null);
   const places = useRef(new Map<string, { x: number; y: number }>());
   const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
   useLayoutEffect(() => {
      pillTargets.clear();
      const element = area.current;
      if (!element) return;
      // Final boxes from layout offsets, so flights aim past any glide in progress.
      const origin = element.getBoundingClientRect();
      for (const pill of Array.from(element.querySelectorAll<HTMLElement>(".notification-pill"))) {
         const tone = pill.dataset["tone"] as NotificationTone | undefined;
         if (tone) pillTargets.set(tone, new DOMRect(origin.left + pill.offsetLeft, origin.top + pill.offsetTop, pill.offsetWidth, pill.offsetHeight));
      }
      for (const pill of Array.from(element.querySelectorAll<HTMLElement>(".notification-pill")))
         if (!places.current.has(pill.dataset["tone"] ?? "") && !pill.classList.contains("awaiting")) popIn(pill);
      glide(element, places.current, (child) => child.dataset["tone"]);
   });
   useEffect(() => {
      if (total < 2) setLogOpen(false);
   }, [total]);
   if (!groups.length) return null;
   const toggle = (entry: NotificationEntry) => (open === entry.id ? closePinned(entry.id, entry.tone, closeOpen) : toggleOpen(entry.id));
   const [primary, ...others] = groups;
   const newest = primary!.entries[0]!;
   return (
      <div className="notification-area" ref={area}>
         {[...others].reverse().map(({ tone, entries: group }) => (
            <div key={tone} className="notification-pill" data-tone={tone} data-notification-chip={group.map((entry) => entry.id).join(" ")}>
               {group.length === 1 ? (
                  <button
                     className={`notification-pill-main${open === group[0]!.id ? " holding" : ""}`}
                     aria-label={`Notification: ${group[0]!.title}`}
                     aria-expanded={open === group[0]!.id}
                     data-tooltip={group[0]!.title}
                     onClick={() => toggle(group[0]!)}
                  >
                     <NotificationIcon tone={tone} size={12} />
                     <ChevronDown className="notification-pill-collapse" size={13} aria-hidden="true" />
                  </button>
               ) : (
                  <button
                     className="notification-pill-main notification-log-toggle"
                     aria-label={`${countLabel(tone, group.length)}, show all`}
                     aria-expanded={logOpen}
                     onClick={() => setLogOpen((value) => !value)}
                  >
                     <NotificationIcon tone={tone} size={12} />
                     <span className="tabular">{group.length}</span>
                  </button>
               )}
            </div>
         ))}
         <div
            key={primary!.tone}
            className="notification-pill primary"
            data-tone={primary!.tone}
            data-notification-chip={primary!.entries.map((entry) => entry.id).join(" ")}
         >
            <button
               className={`notification-pill-main${open === newest.id ? " holding" : ""}`}
               data-tooltip={newest.detail ? `${newest.title}. ${newest.detail}` : newest.title}
               aria-label={`Notification: ${newest.title}`}
               aria-expanded={open === newest.id}
               onClick={() => toggle(newest)}
            >
               <NotificationIcon tone={newest.tone} size={12} />
               <span>{newest.title}</span>
               <ChevronDown className="notification-pill-collapse" size={13} aria-hidden="true" />
            </button>
            {primary!.entries.length > 1 && (
               <button
                  className="notification-pill-count notification-log-toggle"
                  aria-label={`${countLabel(primary!.tone, primary!.entries.length)}, show all`}
                  aria-expanded={logOpen}
                  onClick={() => setLogOpen((value) => !value)}
               >
                  <span key={primary!.entries.length} className="tabular">
                     +{primary!.entries.length - 1}
                  </span>
               </button>
            )}
         </div>
         <Popover open={logOpen} anchor={area} onClose={closeLog} label="Notification log" className="notification-log-popover" placement="above" align="end">
            <NotificationLog entries={groups.flatMap((group) => group.entries)} open={open} close={closeLog} />
         </Popover>
      </div>
   );
}

/** Every chip, most severe first. A row reopens its message; dismiss removes it. */
function NotificationLog({ entries, open, close }: { entries: NotificationEntry[]; open: number | null; close: () => void }) {
   return (
      <>
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
                  <span className="notification-log-age">{entry.condition ? "Ongoing" : age(entry.createdAt)}</span>
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
                  close();
                  sweepOut(clearAll);
               }}
            >
               Clear all
            </button>
         </div>
      </>
   );
}
