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
         data-tooltip={message || undefined}
      >
         {error ? <CircleAlert size={16} /> : <TriangleAlert size={16} />}
         {/* Fields point their description here. The shared tooltip shows the same text on hover. */}
         <span id={id} hidden>
            {message}
         </span>
      </span>
   );
}
