import { useEffect, useRef, useState } from "react";
import { useSliderMotion } from "./useSliderMotion";
import { boundedGain, gainText, parseGain } from "./audio-meter";
import { useHandleReset } from "./slider-handle";
import { readoutKick, useValueKick } from "./value-kick";
// The fader tops out at +6 dB. Typed values can still go to +12 dB, past its end.
const faderMax = 2;
export function MixerFader({
   value,
   muted,
   label,
   disabled,
   onCommit,
}: {
   value: number;
   muted: boolean;
   label: string;
   disabled: boolean;
   onCommit: (value: number, restore: number) => void | Promise<void>;
}) {
   const [display, setDisplay] = useState(muted ? 0 : value),
      [draft, setDraft] = useState<string | null>(null);
   const motion = useSliderMotion<HTMLDivElement>(Math.min(1, display / faderMax) * 100);
   const revision = useRef(0);
   const gestureVolume = useRef<number | null>(null);
   const latest = useRef(muted ? 0 : value),
      timer = useRef<number | undefined>(undefined),
      callback = useRef(onCommit),
      changing = useRef(false);
   callback.current = onCommit;
   useEffect(() => {
      if (!changing.current) {
         latest.current = muted ? 0 : value;
         setDisplay(muted ? 0 : value);
      }
   }, [value, muted]);
   useEffect(() => () => window.clearTimeout(timer.current), []);
   const dragging = useRef(false),
      exact = useRef(false),
      input = useRef<HTMLInputElement>(null);
   const commit = (next: number) => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      const committed = revision.current;
      changing.current = true;
      void Promise.resolve(callback.current(next, gestureVolume.current ?? value))
         .finally(() => {
            if (committed === revision.current && !dragging.current) changing.current = false;
         })
         .catch(() => undefined);
   };
   const change = (value: number) => {
      let next = boundedGain(value);
      if (
         dragging.current &&
         !exact.current &&
         input.current &&
         (Math.abs(next - 1) / faderMax) * Math.max(1, input.current.getBoundingClientRect().width - 16) <= 5
      )
         next = 1;
      revision.current += 1;
      latest.current = next;
      setDisplay(next);
      changing.current = true;
      if (timer.current === undefined) timer.current = window.setTimeout(() => commit(latest.current), 60);
   };
   const reset = () => {
      change(1);
      commit(1);
   };
   const handleReset = useHandleReset(".mixer-fader-thumb", reset);
   const readout = useRef<HTMLSpanElement>(null);
   useValueKick(display, readout, readoutKick, () => draft !== null, faderMax);
   const accept = () => {
      if (draft !== null) {
         const gain = parseGain(draft);
         if (gain !== null) {
            change(gain);
            commit(gain);
         }
         setDraft(null);
      }
   };
   return (
      <div className="mixer-fader" ref={motion}>
         <span className="mixer-fader-control">
            <input
               ref={input}
               className="mixer-fader-range"
               type="range"
               aria-label={label}
               aria-valuetext={display <= 0 ? "Silence" : `${gainText(display)} dB`}
               min={0}
               max={faderMax}
               step={0.01}
               value={Math.min(display, faderMax)}
               disabled={disabled}
               onChange={(event) => change(Number(event.target.value))}
               onPointerDown={(event) => {
                  gestureVolume.current = value;
                  exact.current = event.shiftKey;
                  dragging.current = true;
               }}
               onPointerMove={(event) => {
                  exact.current = event.shiftKey;
               }}
               onPointerUp={() => {
                  dragging.current = false;
                  commit(latest.current);
                  gestureVolume.current = null;
               }}
               onPointerCancel={() => {
                  dragging.current = false;
                  commit(latest.current);
                  gestureVolume.current = null;
               }}
               onKeyUp={() => {
                  commit(latest.current);
                  gestureVolume.current = null;
               }}
               onBlur={() => {
                  dragging.current = false;
                  if (changing.current) commit(latest.current);
                  gestureVolume.current = null;
               }}
               onMouseDown={handleReset.onMouseDown}
               onDoubleClick={handleReset.onDoubleClick}
               onKeyDown={(event) => {
                  gestureVolume.current ??= value;
                  if (event.key === "Delete") {
                     event.preventDefault();
                     reset();
                  }
               }}
            />
            <span className="mixer-fader-track" aria-hidden="true">
               <span className="mixer-fader-fill" />
               <span className="mixer-fader-thumb" />
            </span>
         </span>
         <span className="mixer-gain-value">
            <span className="mixer-gain-content" ref={readout}>
               <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${label} in decibels`}
                  value={draft ?? gainText(display)}
                  disabled={disabled}
                  onFocus={() => setDraft(gainText(display))}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={accept}
                  onKeyDown={(event) => {
                     if (event.key === "Enter") {
                        event.preventDefault();
                        accept();
                     } else if (event.key === "Escape") {
                        setDraft(null);
                        event.preventDefault();
                     } else if (["ArrowUp", "ArrowDown"].includes(event.key)) {
                        event.preventDefault();
                        setDraft(null);
                        const next = boundedGain(latest.current + (event.key === "ArrowUp" ? 0.01 : -0.01));
                        change(next);
                        commit(next);
                     }
                  }}
               />
               {(draft !== null || display > 0) && <span aria-hidden="true">dB</span>}
            </span>
         </span>
      </div>
   );
}
