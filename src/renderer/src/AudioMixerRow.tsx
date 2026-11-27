import type { ReactNode } from "react";
import { CircleOff, WandSparkles, GripVertical, MoreHorizontal, TriangleAlert, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { IconButton, Menu } from "./ui";
import { MixerFader } from "./MixerFader";
import { ListenButton, useIsListening } from "./AudioListening";
import { AudioMeter } from "./AudioMeter";
import { useAudioWarning } from "./useAudioWarning";
import { useVerticalMixer } from "./useVerticalMixer";
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
   issue = "",
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
   /** Why the track records silence right now, such as its app being closed. */
   issue?: string | undefined;
   onEnable: (enabled: boolean) => void;
   onMute: () => void;
   onVolume: (volume: number, restore: number) => void | Promise<void>;
   filters?: { summary: string; onOpen: () => void } | undefined;
   options: ReactNode;
}) {
   const listening = useIsListening(sourceId);
   const vertical = useVerticalMixer();
   const shownIssue = useAudioWarning(enabled && !muted ? issue : "");
   const VolumeIcon = muted || !enabled || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.67 ? Volume1 : Volume2;
   const muteLabel = ["Source audio", "Desktop", "Application", "Desktop audio", "App audio", "Microphone"].includes(name) ? name.toLowerCase() : name;
   const handle = (
      // Track order sets the recording's tracks, so it waits for capture to stop. The handle stays in view to say so.
      <button
         type="button"
         className="mixer-drag-handle"
         data-list-control=""
         aria-label={`Reorder ${name}`}
         data-tooltip={active ? "Stop capturing to reorder" : undefined}
         disabled={active}
      >
         <GripVertical size={15} />
      </button>
   );
   const issueIcon = shownIssue && (
      <span className="mixer-channel-issue" role="img" tabIndex={0} aria-label={shownIssue} data-tooltip={shownIssue}>
         <TriangleAlert size={15} />
      </span>
   );
   const filterButton = filters && (
      <IconButton className="mixer-channel-filters" label={`${name} filters: ${filters.summary}`} onClick={filters.onOpen}>
         <WandSparkles size={15} />
      </IconButton>
   );
   const menu = (
      <Menu label={`${name} options`} trigger={<MoreHorizontal size={16} />}>
         {options}
      </Menu>
   );
   const muteButton = (
      <IconButton
         className="mixer-mute"
         label={`${!enabled || muted || volume === 0 ? "Unmute" : "Mute"} ${muteLabel}`}
         disabled={!enabled && active}
         onClick={() => (enabled ? onMute() : onEnable(true))}
      >
         <VolumeIcon size={18} />
      </IconButton>
   );
   const fader = <MixerFader label={`${name} level`} value={volume} muted={muted} disabled={!enabled} onCommit={onVolume} />;
   const listen = <ListenButton id={sourceId} name={name} enabled={enabled && listenAvailable} />;
   const meter = <AudioMeter name={name} sourceId={sourceId} captureLevel={captureLevel} muted={muted && !listening} enabled={enabled} visible={visible} />;
   if (vertical)
      return (
         <div className="mixer-channel mixer-strip" data-disabled={!enabled || undefined} data-issue={shownIssue ? "" : undefined}>
            <span className="mixer-channel-name" data-tooltip={enabled ? name : `${name}: not recorded`}>
               {name}
            </span>
            <div className="mixer-strip-tools">
               {handle}
               {!enabled && (
                  <span className="mixer-channel-status" role="img" tabIndex={0} aria-label="Not recorded" data-tooltip="Not recorded">
                     <CircleOff size={14} />
                  </span>
               )}
               {issueIcon}
               {filterButton}
               {menu}
            </div>
            {meter}
            {fader}
            {muteButton}
            {listen}
         </div>
      );
   return (
      <div className="mixer-channel" data-disabled={!enabled || undefined} data-issue={shownIssue ? "" : undefined}>
         <div className="mixer-channel-header">
            {handle}
            <span className="mixer-channel-name">{name}</span>
            {!enabled && <span className="mixer-channel-status">Not recorded</span>}
            {issueIcon}
            {filterButton}
            {menu}
         </div>
         <div className="mixer-channel-gain">
            {muteButton}
            {fader}
         </div>
         <div className="audio-meter-controls">
            {listen}
            {meter}
         </div>
      </div>
   );
}
