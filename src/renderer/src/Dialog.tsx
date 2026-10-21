import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { Button, IconButton } from "./ui";

export type Ask = (request: Omit<DialogRequest, "resolve">) => Promise<string | boolean | null>;
export interface DialogRequest {
   title: string;
   detail?: string;
   confirm: string;
   initial?: string;
   danger?: boolean;
   resolve: (value: string | boolean | null) => void;
}
export function Dialog({ request, close }: { request: DialogRequest; close: () => void }) {
   const [value, setValue] = useState(request.initial ?? "");
   const cancel = () => {
      request.resolve(null);
      close();
   };
   const submit = () => {
      request.resolve(request.initial === undefined ? true : value.trim());
      close();
   };
   return (
      <DialogPanel title={request.title} close={cancel} className="" closeLabel="Close">
         {request.detail && <p>{request.detail}</p>}
         <form
            onSubmit={(event) => {
               event.preventDefault();
               submit();
            }}
         >
            {request.initial !== undefined && (
               <input aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} maxLength={150} />
            )}
            <div className="dialog-actions">
               <Button type="button" onClick={cancel}>
                  Cancel
               </Button>
               <Button className={request.danger ? "destructive" : "primary"} disabled={request.initial !== undefined && !value.trim()}>
                  <Check size={16} />
                  {request.confirm}
               </Button>
            </div>
         </form>
      </DialogPanel>
   );
}

export function DialogPanel({
   title,
   close,
   children,
   className = "dialog-panel",
   label,
   closeLabel,
}: {
   title: string;
   close: () => void;
   children: ReactNode;
   className?: string;
   label?: string;
   closeLabel?: string;
}) {
   const card = useRef<HTMLDivElement>(null),
      titleId = useId();
   useLayoutEffect(() => {
      const previous = document.activeElement;
      card.current?.querySelector<HTMLElement>('[role="combobox"]:not(:disabled),input:not(:disabled),button:not(:disabled)')?.focus();
      return () => {
         if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      };
   }, []);
   return createPortal(
      <div className="modal-backdrop" onClick={close}>
         <div
            ref={card}
            className={`dialog ${className}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={label ? undefined : titleId}
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
               if (event.key === "Escape") {
                  event.stopPropagation();
                  close();
               }
               if (event.key === "Tab") {
                  const nodes = [...(card.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? [])].filter(
                     (node) => node.getClientRects().length
                  );
                  const first = nodes[0],
                     last = nodes.at(-1);
                  if (event.shiftKey && document.activeElement === first) {
                     event.preventDefault();
                     last?.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                     event.preventDefault();
                     first?.focus();
                  }
               }
            }}
         >
            <h2 id={titleId}>{title}</h2>
            {children}
            <IconButton label={closeLabel ?? `Close ${title.toLowerCase()}`} className="dialog-close" onClick={close}>
               <X size={17} />
            </IconButton>
         </div>
      </div>,
      document.body
   );
}
