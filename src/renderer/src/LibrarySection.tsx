import { useId } from "react";
import type { ReactNode, TransitionEvent } from "react";
import { ChevronRight } from "lucide-react";

export function LibrarySection({
   label,
   empty,
   open,
   toggle,
   action,
   children,
}: {
   label: string;
   empty: boolean;
   open: boolean;
   toggle: () => void;
   action: ReactNode;
   children: ReactNode;
}) {
   const id = useId();
   const expanded = empty || open;
   const followFold = (event: TransitionEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && event.propertyName === "grid-template-rows")
         event.currentTarget.dispatchEvent(new Event("list-motion", { bubbles: true }));
   };
   return (
      <section className="sidebar-section" data-empty={empty || undefined} aria-label={label}>
         <div className="sidebar-group-title">
            <button
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
