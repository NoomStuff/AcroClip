import type { ReactNode } from "react";
import { MoreHorizontal, Volume2, VolumeX } from "lucide-react";
import { IconButton, Menu } from "./ui";
import { MixerFader } from "./MixerFader";
import { ListenButton, useIsListening } from "./AudioListening";
import { AudioMeter } from "./AudioMeter";
export function AudioMixerRow({
   name,
   sourceId,
   enabled,
   listenAvailable = true,
   muted,
   volume,
   level,
   active,
   visible,
   onEnable,
   onMute,
   onVolume,
   children,
   options,
   status,
   className = "",
}: {
   name: string;
   sourceId: string;
   enabled: boolean;
   listenAvailable?: boolean;
   muted: boolean;
   volume: number;
   level: number;
   active: boolean;
   visible: boolean;
   onEnable: (enabled: boolean) => void;
   onMute: () => void;
   onVolume: (volume: number) => void | Promise<void>;
   children?: ReactNode;
   options?: ReactNode;
   status?: string;
   className?: string;
}) {
   const listening = useIsListening(sourceId);
   const controlName = name;
   return (
      <div className={`mixer-channel ${className}`} data-disabled={!enabled || undefined}>
         <div className="mixer-channel-header">
            <span className="mixer-channel-name">{name}</span>
            {children}
            {status && <span className="mixer-channel-status">{status}</span>}
            {options && (
               <Menu label={`${name} options`} trigger={<MoreHorizontal size={16} />}>
                  {options}
               </Menu>
            )}
         </div>
         <div className="mixer-channel-gain">
            <IconButton
               label={`${!enabled || muted ? "Unmute" : "Mute"} ${controlName === "Source audio" ? "source audio" : controlName === "Desktop audio" ? "desktop audio" : controlName === "App audio" ? "app audio" : controlName === "Microphone" ? "microphone" : controlName}`}
               disabled={!enabled && active}
               onClick={() => (enabled ? onMute() : onEnable(true))}
            >
               {muted || !enabled ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
            <MixerFader label={`${controlName} level`} value={volume} disabled={!enabled} onCommit={onVolume} />
         </div>
         <div className="audio-meter-controls">
            <ListenButton id={sourceId} name={controlName} enabled={enabled && listenAvailable} />
            <AudioMeter name={controlName} level={level} muted={muted && !listening} enabled={enabled} visible={visible} />
         </div>
      </div>
   );
}
