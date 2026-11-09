import { Gauge, Headphones, ListVideo, Maximize, Minimize, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loudnessCurve } from "./loudness-curve";
import type { CSSProperties, RefObject } from "react";
import type { AudioTrack } from "../../shared/types";
import { DropdownSelect } from "./DropdownSelect";
import { formatTime } from "./format";
import { IconButton } from "./ui";
import { ViewerVolume } from "./ViewerVolume";
export function ViewerTransport({
   time: initialTime,
   video,
   visible,
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
   previousTitle,
   nextTitle,
   queueLabel,
   autoAdvance,
   onAutoAdvance,
   onPrevious,
   onNext,
   loudness,
   onSeek,
   onToggle,
   onVolume,
   onMute,
   onTrack,
   onFullscreen,
}: {
   time: number;
   video: RefObject<HTMLVideoElement | null>;
   visible: boolean;
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
   previousTitle: string | undefined;
   nextTitle: string | undefined;
   // Where this clip sits, such as "Ranked · 3 of 12". Empty for a queue of one.
   queueLabel: string;
   autoAdvance: boolean;
   onAutoAdvance: (value: boolean) => void;
   onPrevious: () => void;
   onNext: () => void;
   loudness: number[] | undefined;
   onSeek: (value: number) => void;
   onToggle: () => void;
   onVolume: (value: number, restore: number) => void;
   onMute: () => void;
   onTrack: (value: number[]) => void;
   onFullscreen: () => void;
}) {
   // The playback clock only redraws transport controls. Sidebar, menus and
   // export controls do not need to reconcile on every video frame.
   const [time, setTime] = useState(initialTime);
   useEffect(() => {
      const media = video.current;
      if (!media || !visible || disabled) return;
      let frame = 0;
      const update = () => setTime(media.currentTime);
      const tick = () => {
         update();
         frame = requestAnimationFrame(tick);
      };
      update();
      media.addEventListener("timeupdate", update);
      media.addEventListener("seeked", update);
      if (playing) frame = requestAnimationFrame(tick);
      return () => {
         cancelAnimationFrame(frame);
         media.removeEventListener("timeupdate", update);
         media.removeEventListener("seeked", update);
      };
   }, [video, visible, playing, initialTime, disabled]);
   const seekTo = (next: number) => {
      // Keep the controlled range at the requested position during the input
      // event, before the media element emits its asynchronous seek events.
      setTime(next);
      onSeek(next);
   };
   const curve = useMemo(() => (loudness ? loudnessCurve(loudness) : null), [loudness]);
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
            {curve && (
               // Shown while the seek bar is hovered or dragged, like a "most replayed" graph.
               <span className="player-loudness" aria-hidden="true">
                  <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
                     <path d={curve.path} />
                  </svg>
                  <svg className="played" viewBox="0 0 1000 100" preserveAspectRatio="none">
                     <path d={curve.path} />
                  </svg>
               </span>
            )}
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
               onChange={(event) => seekTo(Number(event.target.value))}
               onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                     event.preventDefault();
                     event.stopPropagation();
                     seekTo(Math.min(duration, Math.max(0, time + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1))));
                  }
               }}
            />
         </label>
         <div className="player-control-row">
            <span className="player-time tabular">
               <time>{formatTime(time)}</time>
               <span>/</span>
               <time>{formatTime(duration)}</time>
               {queueLabel && (
                  <span className="player-queue" title={queueLabel}>
                     {queueLabel}
                  </span>
               )}
            </span>
            <div className="player-playback">
               <IconButton
                  label={previousTitle ? `Previous clip: ${previousTitle}` : "Restart clip"}
                  title={previousTitle ? `Previous: ${previousTitle}. Restarts the clip after the first few seconds.` : "Restart clip"}
                  className="player-skip-button"
                  disabled={disabled}
                  onClick={onPrevious}
               >
                  <SkipBack size={15} fill="currentColor" />
               </IconButton>
               <IconButton
                  label={playing ? "Pause" : "Play"}
                  disabled={disabled}
                  className="player-play-button"
                  data-playing={playing || undefined}
                  onClick={onToggle}
               >
                  {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
               </IconButton>
               <IconButton
                  label={nextTitle ? `Next clip: ${nextTitle}` : "Last clip in this view"}
                  className="player-skip-button"
                  disabled={!nextTitle}
                  onClick={onNext}
               >
                  <SkipForward size={15} fill="currentColor" />
               </IconButton>
            </div>
            <div className="player-volume-controls">
               <IconButton
                  label="Play the next clip automatically"
                  className="player-auto-advance"
                  aria-pressed={autoAdvance}
                  onClick={() => onAutoAdvance(!autoAdvance)}
               >
                  <ListVideo size={16} />
               </IconButton>
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
