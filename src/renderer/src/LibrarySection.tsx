import { useId, useRef, useState } from "react";
import type { ReactNode, TransitionEvent } from "react";
import { ChevronRight } from "lucide-react";
import { Menu } from "./ui";
import type { ContextMenuRequest } from "./ui";

export function LibrarySection({
   label,
   empty,
   open,
   toggle,
   action,
   menu,
   children,
}: {
   label: string;
   empty: boolean;
   open: boolean;
   toggle: () => void;
   action: ReactNode;
   /** Items for the menu that right-clicking the section's title opens. */
   menu: ReactNode;
   children: ReactNode;
}) {
   const id = useId();
   const expanded = empty || open;
   const control = useRef<HTMLButtonElement>(null);
   const [menuRequest, setMenuRequest] = useState<ContextMenuRequest | null>(null);
   const followFold = (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && event.propertyName === "grid-template-rows")
         event.currentTarget.dispatchEvent(new Event("list-motion", { bubbles: true }));
   };
   return (
      <section className="sidebar-section" data-empty={empty || undefined} aria-label={label}>
         <div
            className="sidebar-group-title"
            onContextMenu={(event) => {
               event.preventDefault();
               setMenuRequest({ left: event.clientX, top: event.clientY, restoreFocus: control.current ?? event.currentTarget });
            }}
            onKeyDown={(event) => {
               if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
               event.preventDefault();
               const bounds = event.currentTarget.getBoundingClientRect();
               setMenuRequest({ left: bounds.left + 20, top: bounds.bottom, restoreFocus: control.current ?? event.currentTarget });
            }}
         >
            <button
               ref={control}
               className="sidebar-section-control"
               data-list-control=""
               aria-expanded={empty ? undefined : expanded}
               aria-controls={empty ? undefined : id}
               onClick={empty ? undefined : toggle}
            >
               {!empty && <ChevronRight size={12} aria-hidden="true" />}
               {label}
            </button>
            {action}
            <Menu label={`${label} actions`} contextRequest={menuRequest ?? undefined} onContextClose={() => setMenuRequest(null)}>
               {menu}
            </Menu>
         </div>
         <div
            className="sidebar-section-fold"
            data-open={expanded || undefined}
            id={id}
            inert={!expanded}
            aria-hidden={!expanded}
            onTransitionRun={followFold}
            onTransitionEnd={followFold}
         >
            <div className="sidebar-section-body">{children}</div>
         </div>
      </section>
   );
}
