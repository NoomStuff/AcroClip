import { CircleDot, CircleStop, Clapperboard, PanelTop, TriangleAlert, Volume2 } from "lucide-react";
import { notificationActions } from "../../shared/notifications";
import type { NotificationEditableKey, NotificationPreferences } from "../../shared/notifications";
import { Toggle } from "./ui";

const rows = [
   { action: "startRecording", label: "Start capture", detail: "When capture starts.", icon: CircleDot },
   { action: "stopRecording", label: "Stop capture", detail: "When capture stops.", icon: CircleStop },
   { action: "saveClip", label: "Save clip", detail: "When saving begins and finishes.", icon: Clapperboard },
   { action: "error", label: "Error", detail: "Capture and save failures.", icon: TriangleAlert },
] as const;

export function NotificationSettings({
   value,
   onChange,
}: {
   value: NotificationPreferences;
   onChange: (key: NotificationEditableKey, enabled: boolean) => void;
}) {
   return (
      <section className="settings-group notification-settings" aria-label="Notification preferences">
         <div className="notification-columns">
            <h2>Choose how you're notified</h2>
            <span className="notification-column-label" aria-hidden="true">
               <PanelTop size={18} />
               Banner
            </span>
            <span className="notification-column-label" aria-hidden="true">
               <Volume2 size={18} />
               Sound
            </span>
         </div>
         {rows.map(({ action, label, detail, icon: Icon }) => {
            const keys = notificationActions[action];
            const locked = action === "error";
            return (
               <div className="settings-row notification-settings-row" key={action}>
                  <Icon className="settings-row-icon" size={21} aria-hidden="true" />
                  <div className="settings-row-copy">
                     <span className="field-label">{label}</span>
                     <p className="field-detail">{detail}</p>
                  </div>
                  <div className="notification-switch" title={locked ? "Error banners are always on" : `${label} banner`}>
                     <Toggle
                        label={`${label} banner`}
                        checked={locked || value[keys.banner]}
                        disabled={locked}
                        onChange={(enabled) => {
                           if (keys.banner !== "notificationErrorBanner") onChange(keys.banner, enabled);
                        }}
                     />
                  </div>
                  <div className="notification-switch">
                     <Toggle label={`${label} sound`} checked={value[keys.sound]} onChange={(enabled) => onChange(keys.sound, enabled)} />
                  </div>
               </div>
            );
         })}
      </section>
   );
}
