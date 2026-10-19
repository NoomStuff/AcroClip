// Copyright (c) 2026 NoomStuff
// SPDX-License-Identifier: MIT
// Adapted from AttaCut Player, Transport, AudioPicker and VolumeSlider.
// See licenses/AttaCut-MIT.txt. No editor or trimming behavior is included.
import { Headphones, Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { CSSProperties } from "react";
import type { AudioTrack } from "../../shared/types";
import { DropdownSelect } from "./DropdownSelect";
import { formatTime, IconButton } from "./ui";
export function ViewerTransport({
   time,
   duration,
   playing,
   volume,
   muted,
   tracks,
   track,
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
   track: number;
   disabled: boolean;
   fullscreen: boolean;
   onSeek: (value: number) => void;
   onToggle: () => void;
   onVolume: (value: number) => void;
   onMute: () => void;
   onTrack: (value: number) => void;
   onFullscreen: () => void;
}) {
   const fraction = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
   const displayedVolume = muted ? 0 : volume;
   const ordinal =
      track < 0
         ? 0
         : Math.max(
              0,
              tracks.findIndex((item) => item.index === track)
           );
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
                  label="Audio track"
                  className="player-audio-picker"
                  placement="up"
                  options={tracks.map((item, index) => ({ value: String(index === 0 ? -1 : item.index), label: item.title || `Track ${index + 1}` }))}
                  value={String(track)}
                  disabled={disabled || tracks.length <= 1}
                  onChange={(value) => onTrack(Number(value))}
                  triggerContent={
                     <>
                        <Headphones size={14} />
                        <b>{tracks.length ? ordinal + 1 : ""}</b>
                     </>
                  }
               />
               <IconButton label={muted || volume === 0 ? "Unmute playback" : "Mute playback"} onClick={onMute} disabled={disabled}>
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
               </IconButton>
               <label className="player-volume-slider" style={{ "--fill": `${displayedVolume * 100}%`, "--volume": displayedVolume } as CSSProperties}>
                  <i aria-hidden="true" />
                  <input
                     type="range"
                     aria-label="Playback volume"
                     min={0}
                     max={1}
                     step={0.01}
                     value={displayedVolume}
                     disabled={disabled}
                     onChange={(event) => onVolume(Number(event.target.value))}
                  />
               </label>
               <span className="player-control-divider" />
               <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} disabled={disabled} onClick={onFullscreen}>
                  {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
               </IconButton>
            </div>
         </div>
      </div>
   );
}
