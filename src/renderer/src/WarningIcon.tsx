import { useEffect, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";

export function WarningIcon({ message, error, id }: { message: string; error: boolean; id: string }) {
   const [hasAppeared, setHasAppeared] = useState(!!message);
   useEffect(() => {
      if (message) setHasAppeared(true);
   }, [message]);
   return (
      <span
         className="filename-warning-icon"
         data-state={message ? "visible" : hasAppeared ? "leaving" : "hidden"}
         data-tone={error ? "danger" : "warning"}
         role="img"
         aria-label={message || undefined}
         aria-hidden={!message}
         tabIndex={message ? 0 : -1}
      >
         {error ? <CircleAlert size={16} /> : <TriangleAlert size={16} />}
         {message && (
            <span className="filename-warning-tooltip" role="tooltip" id={id}>
               {message}
            </span>
         )}
      </span>
   );
}
