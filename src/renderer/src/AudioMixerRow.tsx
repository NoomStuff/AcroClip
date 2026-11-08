import type { ReactNode } from "react";
import { WandSparkles, GripVertical, MoreHorizontal, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
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
   captureLevel,
   active,
   visible,
   onEnable,
   onMute,
   onVolume,
   filters,
   options,
}: {
   name: string;
   sourceId: string;
   enabled: boolean;
   listenAvailable?: boolean;
   muted: boolean;
   volume: number;
   captureLevel: boolean;
   active: boolean;
   visible: boolean;
   onEnable: (enabled: boolean) => void;
   onMute: () => void;
   onVolume: (volume: number, restore: number) => void | Promise<void>;
   filters?: { summary: string; onOpen: () => void } | undefined;
   options: ReactNode;
}) {
   const listening = useIsListening(sourceId);
   const VolumeIcon = muted || !enabled || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.67 ? Volume1 : Volume2;
   const muteLabel = ["Source audio", "Desktop", "Application", "Desktop audio", "App audio", "Microphone"].includes(name) ? name.toLowerCase() : name;
   return (
      <div className="mixer-channel" data-disabled={!enabled || undefined}>
         <div className="mixer-channel-header">
            <button type="button" className="mixer-drag-handle" data-list-control="" aria-label={`Reorder ${name}`} disabled={active}>
               <GripVertical size={15} />
            </button>
            <span className="mixer-channel-name">{name}</span>
            {!enabled && <span className="mixer-channel-status">Not recorded</span>}
            {filters && (
               <IconButton className="mixer-channel-filters" label={`${name} filters: ${filters.summary}`} onClick={filters.onOpen}>
                  <WandSparkles size={15} />
               </IconButton>
            )}
            <Menu label={`${name} options`} trigger={<MoreHorizontal size={16} />}>
               {options}
            </Menu>
         </div>
         <div className="mixer-channel-gain">
            <IconButton
               label={`${!enabled || muted || volume === 0 ? "Unmute" : "Mute"} ${muteLabel}`}
               disabled={!enabled && active}
               onClick={() => (enabled ? onMute() : onEnable(true))}
            >
               <VolumeIcon size={18} />
            </IconButton>
            <MixerFader label={`${name} level`} value={volume} muted={muted} disabled={!enabled} onCommit={onVolume} />
         </div>
         <div className="audio-meter-controls">
            <ListenButton id={sourceId} name={name} enabled={enabled && listenAvailable} />
            <AudioMeter name={name} sourceId={sourceId} captureLevel={captureLevel} muted={muted && !listening} enabled={enabled} visible={visible} />
         </div>
      </div>
   );
}
