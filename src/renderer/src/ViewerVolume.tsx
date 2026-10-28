// Copyright (c) 2026 NoomStuff. MIT. Adapted from AttaCut VolumeControl and VolumeSlider.
// See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "./ui";

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
   const gestureVolume = useRef<number | null>(null);
   const finishGesture = () => {
      gestureVolume.current = null;
   };
   useEffect(() => () => clearTimeout(timer.current), []);
   const displayed = muted ? 0 : volume;
   const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.67 ? Volume1 : Volume2;
   return (
      <div
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
         <IconButton label={muted || volume === 0 ? "Unmute playback" : "Mute playback"} onClick={onMute} disabled={disabled}>
            <VolumeIcon size={16} />
         </IconButton>
         <div className="player-volume-popover">
            <div className="player-volume-panel">
               <span className="player-volume-slider" style={{ "--fill": `${displayed * 100}%`, "--volume": displayed } as CSSProperties}>
                  <i aria-hidden="true" />
                  <input
                     type="range"
                     aria-label="Playback volume"
                     min={0}
                     max={1}
                     step={0.01}
                     value={displayed}
                     disabled={disabled}
                     onPointerDown={() => {
                        gestureVolume.current = volume;
                     }}
                     onPointerUp={finishGesture}
                     onPointerCancel={finishGesture}
                     onLostPointerCapture={finishGesture}
                     onKeyDown={() => {
                        gestureVolume.current ??= volume;
                     }}
                     onKeyUp={finishGesture}
                     onBlur={finishGesture}
                     onChange={(event) => onVolume(Number(event.target.value), gestureVolume.current ?? volume)}
                  />
               </span>
            </div>
         </div>
      </div>
   );
}
