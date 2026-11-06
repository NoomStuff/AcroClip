import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, X } from "lucide-react";
import { dismiss, expire, useNotifications } from "./notifications";
import { IconButton } from "./ui";

const NOTICE_MS = 5000;
const ERROR_MS = 9000;

/**
 * The bottom-right toast. The newest notification shows here; chipped ones
 * collapse into the status bar when their countdown ends. Hovering resets the
 * countdown, and a toast reopened from its chip stays until closed.
 */
export function NotificationToast() {
   const { entries, openId } = useNotifications();
   const pinned = openId !== null ? entries.find((entry) => entry.id === openId) : undefined;
   const entry = pinned ?? entries.find((item) => item.toasted);
   const [hovering, setHovering] = useState(false);
   const timer = useRef<number | null>(null);
   const counts = !!entry && !pinned;

   useEffect(() => {
      if (timer.current) window.clearTimeout(timer.current);
      if (!counts || !entry || hovering) return;
      timer.current = window.setTimeout(() => expire(entry.id), entry.error ? ERROR_MS : NOTICE_MS);
      return () => {
         if (timer.current) window.clearTimeout(timer.current);
      };
   }, [counts, entry, hovering]);

   if (!entry) return null;
   return (
      <div
         className={`toast ${entry.error ? "error" : ""}`}
         role={entry.error ? "alert" : "status"}
         onMouseEnter={() => setHovering(true)}
         onMouseLeave={() => setHovering(false)}
      >
         {entry.error ? <AlertCircle size={18} /> : <Check size={18} />}
         <span>{entry.message}</span>
         <IconButton label="Dismiss" onClick={() => dismiss(entry.id)}>
            <X size={15} />
         </IconButton>
      </div>
   );
}
