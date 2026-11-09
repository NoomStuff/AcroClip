import { useId, useRef } from "react";
import { FieldDescription } from "./field-accessibility";
import type { MouseEvent, ReactNode } from "react";
import { Keyboard, Power } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toggle as Switch } from "./ui";

export function Field({
   label,
   detail,
   children,
   icon,
   className = "",
}: {
   label: string;
   detail?: ReactNode;
   children: ReactNode;
   icon?: LucideIcon;
   className?: string;
}) {
   const Icon = icon ?? Keyboard;
   const labelId = useId();
   const detailId = useId();
   const reopening = useRef(false);
   const target = (row: HTMLElement) => {
      if (row.querySelector("[data-row-ignore]")) return null;
      const element = row.querySelector<HTMLElement>("[data-row-target]");
      return element && !element.matches(":disabled") ? element : null;
   };
   // A row with one main control acts as that control, like a toggle row acts as its switch.
   const activate = (event: MouseEvent<HTMLDivElement>) => {
      const element = target(event.currentTarget);
      if (!element || reopening.current || (event.target as Element).closest(".field-control")) return;
      element.focus({ preventScroll: true });
      if (element instanceof HTMLInputElement) element.select();
      else element.click();
   };
   return (
      <FieldDescription.Provider value={detail ? detailId : undefined}>
         <div
            className={`settings-row field ${className}`}
            role="group"
            aria-labelledby={labelId}
            onPointerDown={(event) => {
               // A dropdown closes on this press. The click must not open it again.
               reopening.current = target(event.currentTarget)?.getAttribute("aria-expanded") === "true";
            }}
            onClick={activate}
         >
            <Icon className="settings-row-icon" size={21} aria-hidden="true" />
            <div className="settings-row-copy">
               <span className="field-label" id={labelId}>
                  {label}
               </span>
               {detail && (
                  <p className="field-detail" id={detailId}>
                     {detail}
                  </p>
               )}
            </div>
            <div className="field-control">{children}</div>
         </div>
      </FieldDescription.Provider>
   );
}

export function Toggle({
   label,
   detail,
   checked,
   onChange,
   icon: Icon = Power,
}: {
   label: string;
   detail?: string;
   checked: boolean;
   onChange: (value: boolean) => void;
   icon?: LucideIcon;
}) {
   return (
      <div className="settings-row settings-toggle">
         <Icon className="settings-row-icon" size={21} aria-hidden="true" />
         <Switch label={label} {...(detail ? { detail } : {})} checked={checked} onChange={onChange} />
      </div>
   );
}
