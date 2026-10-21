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
   options,
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
   options: ReactNode;
}) {
   const listening = useIsListening(sourceId);
   const muteLabel = ["Source audio", "Desktop audio", "App audio", "Microphone"].includes(name) ? name.toLowerCase() : name;
   return (
      <div className="mixer-channel" data-disabled={!enabled || undefined}>
         <div className="mixer-channel-header">
            <span className="mixer-channel-name">{name}</span>
            {!enabled && <span className="mixer-channel-status">Not recorded</span>}
            <Menu label={`${name} options`} trigger={<MoreHorizontal size={16} />}>
               {options}
            </Menu>
         </div>
         <div className="mixer-channel-gain">
            <IconButton
               label={`${!enabled || muted ? "Unmute" : "Mute"} ${muteLabel}`}
               disabled={!enabled && active}
               onClick={() => (enabled ? onMute() : onEnable(true))}
            >
               {muted || !enabled ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
            <MixerFader label={`${name} level`} value={volume} disabled={!enabled} onCommit={onVolume} />
         </div>
         <div className="audio-meter-controls">
            <ListenButton id={sourceId} name={name} enabled={enabled && listenAvailable} />
            <AudioMeter name={name} level={level} muted={muted && !listening} enabled={enabled} visible={visible} />
         </div>
      </div>
   );
}
