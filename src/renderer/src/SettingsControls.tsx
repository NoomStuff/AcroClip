import type { ReactNode } from "react";
import { Bell, Clock3, Copy, Cpu, FileVideo, FolderTree, Gauge, Keyboard, Monitor, Power, RefreshCw, Scissors, SlidersHorizontal, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toggle as Switch } from "./ui";

const icons: Record<string, LucideIcon> = {
   "Clip length": Clock3,
   "Resolution limit": Monitor,
   "Frame rate": Gauge,
   Compression: SlidersHorizontal,
   "Allow software encoding": Cpu,
   "Reduce clip overlap": Scissors,
   "Recording quality": FileVideo,
   "Group clips by application": FolderTree,
   "Default maximum size": FileVideo,
   "Automatically create shareables": Copy,
   "Show notifications": Bell,
   "Play a sound": Volume2,
   "Start with your computer": Power,
   "Start recording when AcroClip opens": FileVideo,
   "Check for updates at startup": RefreshCw,
};

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
   const Icon = icon ?? icons[label] ?? Keyboard;
   return (
      <div className={`settings-row field ${className}`}>
         <Icon className="settings-row-icon" size={21} aria-hidden="true" />
         <div className="settings-row-copy">
            <span className="field-label">{label}</span>
            {detail && <p className="field-detail">{detail}</p>}
         </div>
         <div className="field-control">{children}</div>
      </div>
   );
}

export function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (value: boolean) => void }) {
   const Icon = icons[label] ?? Power;
   return (
      <div className="settings-row settings-toggle">
         <Icon className="settings-row-icon" size={21} aria-hidden="true" />
         <Switch label={label} {...(detail ? { detail } : {})} checked={checked} onChange={onChange} />
      </div>
   );
}
