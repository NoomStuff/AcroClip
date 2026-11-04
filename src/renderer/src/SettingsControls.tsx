import { useId } from "react";
import { FieldDescription } from "./field-accessibility";
import type { ReactNode } from "react";
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
   return (
      <FieldDescription.Provider value={detail ? detailId : undefined}>
         <div className={`settings-row field ${className}`} role="group" aria-labelledby={labelId}>
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
