import { Gauge, Headphones, ListVideo, Maximize, Minimize, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { loudnessCurve } from "./loudness-curve";
import { useKeyframeScrub } from "./useKeyframeScrub";
import type { CSSProperties, RefObject } from "react";
import type { AudioTrack, Clip } from "../../shared/types";
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
   preview,
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
   // The clip whose keyframes preview a position while the seek bar is hovered.
   preview: Pick<Clip, "id" | "thumbnail" | "width" | "height">;
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
   const scrub = useKeyframeScrub(preview, visible && !disabled && duration > 0, { eager: true });
   const [bar, setBar] = useState(0);
   const gradient = useId();
   // Landscape previews share a width and portrait ones a height, like the clip itself.
   const previewSize =
      preview.height > preview.width
         ? { width: Math.round((150 * preview.width) / preview.height), height: 150 }
         : { width: 176, height: Math.round((176 * preview.height) / Math.max(1, preview.width)) };
   const audioLabel = !tracks.length
      ? "None"
      : track.length === tracks.length
        ? "All"
        : track.length === 1
          ? String(tracks.findIndex((item) => item.index === track[0]) + 1)
          : `${track.length}/${tracks.length}`;
   return (
      <div className="player-controls">
         <label
            className="player-progress"
            style={{ "--played": `${fraction * 100}%`, "--hovered": `${(scrub.position ?? 0) * 100}%` } as CSSProperties}
            data-hovering={scrub.position !== null || undefined}
            onPointerMove={(event) => {
               if (event.pointerType === "touch") return;
               const bounds = event.currentTarget.getBoundingClientRect();
               setBar(bounds.width);
               scrub.setPosition(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)));
            }}
            onPointerLeave={() => scrub.setPosition(null)}
         >
            {curve && (
               // Shown while the seek bar is hovered or dragged, like a "most replayed" graph.
               <span className="player-loudness" aria-hidden="true">
                  <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
                     <defs>
                        <linearGradient id={`${gradient}-rest`} x1="0" y1="0" x2="0" y2="1">
                           <stop offset="0" stopColor="var(--loudness-rest)" stopOpacity="0.22" />
                           <stop offset="1" stopColor="var(--loudness-rest)" stopOpacity="0.03" />
                        </linearGradient>
                        <linearGradient id={`${gradient}-played`} x1="0" y1="0" x2="0" y2="1">
                           <stop offset="0" stopColor="var(--accent)" stopOpacity="0.34" />
                           <stop offset="1" stopColor="var(--accent)" stopOpacity="0.04" />
                        </linearGradient>
                     </defs>
                     <path d={curve.path} fill={`url(#${gradient}-rest)`} />
                     <path className="player-loudness-line" d={curve.line} />
                  </svg>
                  <svg className="played" viewBox="0 0 1000 100" preserveAspectRatio="none">
                     <path d={curve.path} fill={`url(#${gradient}-played)`} />
                     <path className="player-loudness-line" d={curve.line} />
                  </svg>
               </span>
            )}
            {scrub.position !== null && (
               <span
                  className="player-preview"
                  aria-hidden="true"
                  data-ready={scrub.shown || undefined}
                  style={{
                     // Kept inside the bar so the preview never hangs off the player's edge.
                     left: `${Math.min(Math.max(scrub.position * bar, previewSize.width / 2), Math.max(previewSize.width / 2, bar - previewSize.width / 2))}px`,
                  }}
               >
                  <span className="player-preview-frame" style={{ width: previewSize.width, height: previewSize.height }}>
                     <canvas ref={scrub.canvas} />
                  </span>
                  <time className="tabular">{formatTime(scrub.position * duration)}</time>
               </span>
            )}
            <span className="player-progress-track" />
            <span className="player-progress-hover" />
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
