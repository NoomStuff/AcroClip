import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "./ui";
import { pointerSmoothingMs, useSmoothValue } from "./useSmoothValue";

/** One mouse wheel notch. */
const volumeStep = 0.05;
// Matches the thumb inset in Viewer.css, so the pointer and the thumb line up.
const thumbInset = 6;

export function ViewerVolume({
   volume,
   muted,
   disabled,
   onVolume,
   onMute,
}: {
   volume: number;
   muted: boolean;
   disabled: boolean;
   onVolume: (value: number, restore: number) => void;
   onMute: () => void;
}) {
   const [hovered, setHovered] = useState(false);
   const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
   const root = useRef<HTMLDivElement>(null);
   useEffect(() => () => clearTimeout(timer.current), []);
   const silent = muted || volume === 0;
   const VolumeIcon = silent ? VolumeX : volume < 0.33 ? Volume : volume < 0.67 ? Volume1 : Volume2;
   // Scrolling over the button or the slider steps the volume. The listener is native and not
   // passive, so the wheel never also scrolls the page behind it.
   const latest = useRef({ volume, muted, disabled, onVolume });
   latest.current = { volume, muted, disabled, onVolume };
   useEffect(() => {
      const element = root.current;
      if (!element) return;
      // One scroll gesture remembers the level it started from, so scrolling down to silence
      // restores it on unmute like dragging does. The unrounded level carries through the
      // gesture, so small trackpad deltas still add up.
      let gesture: { restore: number; level: number } | null = null;
      let settle: ReturnType<typeof setTimeout> | undefined;
      const wheel = (event: WheelEvent) => {
         const current = latest.current;
         if (!event.deltaY || current.disabled) return;
         event.preventDefault();
         event.stopPropagation();
         const shown = current.muted ? 0 : current.volume;
         gesture ??= { restore: current.volume, level: shown };
         clearTimeout(settle);
         settle = setTimeout(() => (gesture = null), 400);
         // A mouse notch moves 5%. Trackpads report pixels and move proportionally.
         const notches = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY / 3 : event.deltaY / 100;
         gesture.level = Math.min(1, Math.max(0, gesture.level - notches * volumeStep));
         const next = Math.round(gesture.level * 100) / 100;
         if (next !== shown) current.onVolume(next, gesture.restore);
      };
      element.addEventListener("wheel", wheel, { passive: false });
      return () => {
         element.removeEventListener("wheel", wheel);
         clearTimeout(settle);
      };
   }, []);
   return (
      <div
         ref={root}
         className="player-volume-control"
         data-open={hovered || undefined}
         onPointerEnter={(event) => {
            if (event.pointerType !== "touch") {
               clearTimeout(timer.current);
               setHovered(true);
            }
         }}
         onPointerLeave={() => {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setHovered(false), 350);
         }}
      >
         <IconButton label={silent ? "Unmute playback" : "Mute playback"} onClick={onMute} disabled={disabled}>
            <VolumeIcon size={16} />
         </IconButton>
         <div className="player-volume-popover">
            <div className="player-volume-panel">
               <b className="player-volume-value" aria-hidden="true">
                  {Math.round((muted ? 0 : volume) * 100)}
               </b>
               <VolumeSlider volume={volume} muted={muted} disabled={disabled} onChange={onVolume} />
            </div>
         </div>
      </div>
   );
}

/**
 * A vertical level that fills from the bottom, like a meter above its button. Pointer dragging
 * is handled here rather than by the range input, whose track styling doesn't follow vertical
 * writing modes. The input stays for keyboard control and assistive technology.
 */
function VolumeSlider({
   volume,
   muted,
   disabled,
   onChange,
}: {
   volume: number;
   muted: boolean;
   disabled: boolean;
   onChange: (value: number, restore: number) => void;
}) {
   const gestureVolume = useRef<number | null>(null);
   const input = useRef<HTMLInputElement>(null);
   const [dragging, setDragging] = useState(false);
   const level = muted ? 0 : volume;
   const displayed = useSmoothValue(level, { follow: pointerSmoothingMs });
   const finish = () => {
      gestureVolume.current = null;
      setDragging(false);
   };
   const at = (event: ReactPointerEvent<HTMLElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const travel = bounds.height - thumbInset * 2;
      const value = travel > 0 ? (bounds.bottom - thumbInset - event.clientY) / travel : 0;
      return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
   };
   return (
      <span
         className="player-volume-slider"
         data-disabled={disabled || undefined}
         data-dragging={dragging || undefined}
         style={{ "--fill": `${displayed * 100}%`, "--volume": displayed } as CSSProperties}
         onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            input.current?.focus({ preventScroll: true });
            gestureVolume.current = volume;
            setDragging(true);
            onChange(at(event), volume);
         }}
         onPointerMove={(event) => {
            if (gestureVolume.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            onChange(at(event), gestureVolume.current);
         }}
         onPointerUp={finish}
         onPointerCancel={finish}
         onLostPointerCapture={finish}
      >
         <i aria-hidden="true" />
         <input
            ref={input}
            type="range"
            aria-label="Playback volume"
            aria-orientation="vertical"
            min={0}
            max={1}
            step={0.01}
            value={level}
            disabled={disabled}
            onKeyDown={() => {
               gestureVolume.current ??= volume;
            }}
            onKeyUp={() => {
               gestureVolume.current = null;
            }}
            onBlur={() => {
               gestureVolume.current = null;
            }}
            onChange={(event) => onChange(Number(event.currentTarget.value), gestureVolume.current ?? volume)}
         />
      </span>
   );
}
