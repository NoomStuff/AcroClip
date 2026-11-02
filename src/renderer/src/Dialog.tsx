import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
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
      if (request.initial !== undefined && !value.trim()) return;
      request.resolve(request.initial === undefined ? true : value.trim());
      close();
   };
   return (
      <DialogPanel title={request.title} close={cancel} className="" closeLabel="Close" initialFocus="[data-dialog-initial]">
         {request.detail && <p>{request.detail}</p>}
         <form
            onKeyDown={(event) => {
               if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
               if (!(event.target instanceof HTMLButtonElement) || !event.target.closest(".dialog-actions")) return;
               const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".dialog-actions button:not(:disabled)")];
               const index = buttons.indexOf(event.target);
               if (index < 0) return;
               event.preventDefault();
               event.stopPropagation();
               buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }}
            onSubmit={(event) => {
               event.preventDefault();
               submit();
            }}
         >
            {request.initial !== undefined && (
               <input data-dialog-initial="" aria-label={request.title} value={value} onChange={(event) => setValue(event.target.value)} maxLength={150} />
            )}
            <div className="dialog-actions">
               <Button type="button" onClick={cancel}>
                  Cancel
               </Button>
               <Button
                  data-dialog-initial={request.initial === undefined ? "" : undefined}
                  className={request.danger ? "destructive" : "primary"}
                  disabled={request.initial !== undefined && !value.trim()}
               >
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
   initialFocus,
}: {
   title: string;
   close: () => void;
   children: ReactNode;
   className?: string;
   label?: string;
   closeLabel?: string;
   initialFocus?: string;
}) {
   const card = useRef<HTMLDivElement>(null),
      titleId = useId();
   const backdropPointer = useRef(false);
   const backdrop = useRef<HTMLDivElement>(null);
   useLayoutEffect(() => {
      const node = backdrop.current;
      if (!node) return;
      return () => {
         if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
         const snapshot = node.cloneNode(true) as HTMLDivElement;
         const parent = node.parentElement;
         // Strict Mode replays effects without removing the panel. Only animate
         // an actual removal, including closes initiated by the parent.
         queueMicrotask(() => {
            if (node.isConnected || !parent?.isConnected) return;
            snapshot.inert = true;
            snapshot.setAttribute("aria-hidden", "true");
            snapshot.setAttribute("data-panel-exit", "");
            snapshot.style.animation = "none";
            snapshot.style.pointerEvents = "none";
            for (const element of snapshot.querySelectorAll("[id], [role=dialog]")) {
               element.removeAttribute("id");
               element.removeAttribute("role");
            }
            parent.append(snapshot);
            const animation = snapshot.animate(
               [
                  { opacity: 1, transform: "translateY(0)" },
                  { opacity: 0, transform: "translateY(5px)" },
               ],
               { duration: 120, easing: getComputedStyle(snapshot).getPropertyValue("--ease").trim() || "ease", fill: "forwards" }
            );
            void animation.finished.then(
               () => snapshot.remove(),
               () => snapshot.remove()
            );
         });
      };
   }, []);
   const focusable = useCallback(
      () =>
         [...(card.current?.querySelectorAll<HTMLElement>("button,a[href],input,select,textarea,[tabindex]") ?? [])].filter(
            (node) => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length && !node.closest("[inert]")
         ),
      []
   );
   useLayoutEffect(() => {
      const previous = document.activeElement;
      (initialFocus ? card.current?.querySelector<HTMLElement>(initialFocus) : undefined)?.focus();
      if (!card.current?.contains(document.activeElement)) focusable()[0]?.focus();
      return () => {
         if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      };
   }, [focusable, initialFocus]);
   return createPortal(
      <div
         ref={backdrop}
         className="modal-backdrop"
         onPointerDownCapture={(event) => {
            backdropPointer.current = event.target === event.currentTarget;
         }}
         onClick={(event) => {
            if (event.target === event.currentTarget && backdropPointer.current) close();
         }}
      >
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
                  const nodes = focusable();
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
      document.fullscreenElement ?? document.body
   );
}
