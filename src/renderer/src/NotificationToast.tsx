import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Check, TriangleAlert, X } from "lucide-react";
import { dismiss, expire, useNotifications, type NotificationEntry, type NotificationTone } from "./notifications";
import { flyFromChip, flyToChip, glide, leave } from "./notification-motion";
import { IconButton } from "./ui";

const NOTICE_MS = 4000;
const ERROR_MS = 6500;
/** Older toasts wait their turn instead of filling the screen. */
const MAX_TOASTS = 3;

export function NotificationIcon({ tone, size }: { tone: NotificationTone; size: number }) {
   if (tone === "error") return <AlertCircle size={size} />;
   if (tone === "warning") return <TriangleAlert size={size} />;
   return <Check size={size} />;
}

/** The bottom-right stack. New entries bounce in; chipped ones fly into the status bar when their countdown ends. */
export function NotificationToast() {
   const { entries, open } = useNotifications();
   const stack = useRef<HTMLDivElement>(null);
   const places = useRef(new Map<string, number>());
   const pinned = open !== null ? entries.find((entry) => entry.id === open) : undefined;
   const live = entries.filter((entry) => entry.phase === "toast").slice(0, MAX_TOASTS);
   // Newest sits nearest the status bar.
   const shown = [...(pinned ? [pinned] : []), ...live].reverse();
   useLayoutEffect(() => {
      if (stack.current) glide(stack.current, places.current);
   });
   return (
      <div className="toast-stack" ref={stack}>
         {shown.map((entry) => (
            <Toast key={entry.id} entry={entry} pinned={entry === pinned} />
         ))}
      </div>
   );
}

function Toast({ entry, pinned }: { entry: NotificationEntry; pinned: boolean }) {
   const element = useRef<HTMLDivElement>(null);
   const [hovering, setHovering] = useState(false);
   const counting = !pinned && !hovering;
   const duration = entry.tone === "info" ? NOTICE_MS : ERROR_MS;

   // Hovering holds the toast; leaving starts the countdown over.
   useEffect(() => {
      if (!counting) return;
      const timer = window.setTimeout(() => {
         if (entry.chip) flyToChip(element.current, entry.id, () => expire(entry.id));
         else leave(element.current, () => expire(entry.id));
      }, duration);
      return () => window.clearTimeout(timer);
   }, [counting, duration, entry.id, entry.chip]);

   useLayoutEffect(() => {
      if (pinned && element.current) flyFromChip(element.current, entry.id);
   }, [pinned, entry.id]);

   return (
      <div
         ref={element}
         data-toast-id={entry.id}
         className={`toast toast-surface ${entry.tone}${pinned ? " pinned" : ""}`}
         role={entry.tone === "info" ? "status" : "alert"}
         onMouseEnter={() => setHovering(true)}
         onMouseLeave={() => setHovering(false)}
      >
         <span className="toast-icon">
            <NotificationIcon tone={entry.tone} size={15} />
         </span>
         <div className="toast-text">
            <span className="toast-title">{entry.title}</span>
            {entry.detail && <p className="toast-detail">{entry.detail}</p>}
         </div>
         <IconButton label="Dismiss" onClick={() => leave(element.current, () => dismiss(entry.id))}>
            <X size={14} />
         </IconButton>
         {!pinned && (
            <span key={counting ? "run" : "hold"} className={`toast-timer${counting ? "" : " held"}`} style={{ animationDuration: `${duration}ms` }} />
         )}
      </div>
   );
}
