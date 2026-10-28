// Copyright (c) 2026 NoomStuff
// SPDX-License-Identifier: MIT
// Adapted from AttaCut Player, Transport, AudioPicker and VolumeSlider.
// See THIRD_PARTY_NOTICES.md. No editor or trimming behavior is included.
import { Gauge, Headphones, Maximize, Minimize, Pause, Play } from "lucide-react";
import type { CSSProperties } from "react";
import type { AudioTrack } from "../../shared/types";
import { DropdownSelect } from "./DropdownSelect";
import { formatTime } from "./format";
import { IconButton } from "./ui";
import { ViewerVolume } from "./ViewerVolume";
export function ViewerTransport({
   time,
   duration,
   playing,
   volume,
   muted,
   tracks,
   track,
   speed,
   onSpeed,
   disabled,
   fullscreen,
   onSeek,
   onToggle,
   onVolume,
   onMute,
   onTrack,
   onFullscreen,
}: {
   time: number;
   duration: number;
   playing: boolean;
   volume: number;
   muted: boolean;
   tracks: Pick<AudioTrack, "index" | "title">[];
   track: number[];
   speed: number;
   onSpeed: (value: number) => void;
   disabled: boolean;
   fullscreen: boolean;
   onSeek: (value: number) => void;
   onToggle: () => void;
   onVolume: (value: number, restore: number) => void;
   onMute: () => void;
   onTrack: (value: number[]) => void;
   onFullscreen: () => void;
}) {
   const fraction = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
   const audioLabel = !tracks.length
      ? "None"
      : track.length === tracks.length
        ? "All"
        : track.length === 1
          ? String(tracks.findIndex((item) => item.index === track[0]) + 1)
          : `${track.length}/${tracks.length}`;
   return (
      <div className="player-controls">
         <label className="player-progress" style={{ "--played": `${fraction * 100}%` } as CSSProperties}>
            <span className="player-progress-track" />
            <span className="player-progress-fill" />
            <i aria-hidden="true" />
            <input
               type="range"
               aria-label="Playback position"
               min={0}
               max={duration || 1}
               step={0.01}
               value={Math.min(time, duration || 0)}
               disabled={disabled}
               onChange={(event) => onSeek(Number(event.target.value))}
               onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                     event.preventDefault();
                     event.stopPropagation();
                     onSeek(Math.min(duration, Math.max(0, time + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1))));
                  }
               }}
            />
         </label>
         <div className="player-control-row">
            <span className="player-time tabular">
               <time>{formatTime(time)}</time>
               <span>/</span>
               <time>{formatTime(duration)}</time>
            </span>
            <div className="player-playback">
               <IconButton
                  label={playing ? "Pause" : "Play"}
                  disabled={disabled}
                  className="player-play-button"
                  data-playing={playing || undefined}
                  onClick={onToggle}
               >
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
               </IconButton>
            </div>
            <div className="player-volume-controls">
               <DropdownSelect
                  label="Playback speed"
                  className="player-speed-picker"
                  menuWidth={112}
                  iconOnly
                  triggerContent={
                     <>
                        <Gauge size={16} />
                        <b>
                           {speed}
                           {"\u00d7"}
                        </b>
                     </>
                  }
                  placement="up"
                  options={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({ value: String(value), label: `${value}\u00d7` }))}
                  value={String(speed)}
                  disabled={disabled}
                  onChange={(value) => onSpeed(Number(value))}
               />
               <DropdownSelect
                  label="Audio tracks"
                  className="player-audio-picker"
                  iconOnly
                  placement="up"
                  options={tracks.map((item, index) => ({ value: String(item.index), label: item.title || `Track ${index + 1}` }))}
                  value={track.map(String)}
                  multiple
                  required
                  disabled={tracks.length <= 1}
                  onChange={(values) => onTrack(values.map(Number))}
                  triggerContent={
                     <>
                        <Headphones size={14} />
                        <b>{audioLabel}</b>
                     </>
                  }
               />
               <ViewerVolume volume={volume} muted={muted} onVolume={onVolume} onMute={onMute} disabled={disabled} />
               <span className="player-control-divider" />
               <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} disabled={disabled} onClick={onFullscreen}>
                  {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
               </IconButton>
            </div>
         </div>
      </div>
   );
}
