import { CircleDot, CirclePause, CircleStop, Clapperboard, Gamepad2, PanelTop, TriangleAlert, Volume2 } from "lucide-react";
import { notificationActions } from "../../shared/notifications";
import type { NotificationEditableKey, NotificationPreferenceKey, NotificationPreferences } from "../../shared/notifications";
import { Toggle } from "./ui";

const rows = [
   { action: "startRecording", label: "Start capture", detail: "When capture starts.", icon: CircleDot },
   { action: "stopRecording", label: "Stop capture", detail: "When capture stops.", icon: CircleStop },
   { action: "gameFound", label: "Now capturing", detail: "When Auto finds a game after capture started.", icon: Gamepad2 },
   { action: "gameLost", label: "Stopped capturing game", detail: "When the game Auto was capturing closes.", icon: Gamepad2 },
   { action: "capturePaused", label: "Capture paused", detail: "When the chosen application or screen is lost, and when it's back.", icon: CirclePause },
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
            const keys: { banner: NotificationPreferenceKey; sound?: NotificationEditableKey } = notificationActions[action];
            const banner = keys.banner;
            const sound = keys.sound;
            const locked = banner === "notificationErrorBanner";
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
                        checked={locked || value[banner]}
                        disabled={locked}
                        onChange={(enabled) => {
                           if (banner !== "notificationErrorBanner") onChange(banner, enabled);
                        }}
                     />
                  </div>
                  {/* Source changes and pauses can happen mid-game, so they never make a sound. */}
                  <div className="notification-switch">
                     {sound && <Toggle label={`${label} sound`} checked={value[sound]} onChange={(enabled) => onChange(sound, enabled)} />}
                  </div>
               </div>
            );
         })}
      </section>
   );
}
