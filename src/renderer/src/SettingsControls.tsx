import type { LucideIcon } from "lucide-react";
import { Field as BaseField, Toggle as Switch } from "./ui";
import type { FieldProps } from "./ui";

export function Field({ className = "", ...props }: Omit<FieldProps, "icon"> & { icon: LucideIcon }) {
   return <BaseField {...props} className={`settings-row ${className}`} />;
}

export function Toggle({
   label,
   detail,
   checked,
   onChange,
   icon: Icon,
}: {
   label: string;
   detail?: string;
   checked: boolean;
   onChange: (value: boolean) => void;
   icon: LucideIcon;
}) {
   return (
      <div className="settings-row settings-toggle">
         <Icon className="field-icon" size={21} aria-hidden="true" />
         <Switch label={label} {...(detail ? { detail } : {})} checked={checked} onChange={onChange} />
      </div>
   );
}
