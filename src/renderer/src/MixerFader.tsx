import { useEffect, useRef, useState } from "react";
import { useSliderMotion } from "./useSliderMotion";
import { boundedGain, gainDb, gainText, parseGain } from "./audio-meter";
export function MixerFader({
   value,
   label,
   disabled,
   onCommit,
}: {
   value: number;
   label: string;
   disabled: boolean;
   onCommit: (value: number) => void | Promise<void>;
}) {
   const [display, setDisplay] = useState(value),
      [draft, setDraft] = useState<string | null>(null);
   const motion = useSliderMotion<HTMLDivElement>(Math.min(1, display / 1.41) * 100);
   const revision = useRef(0);
   const latest = useRef(value),
      timer = useRef<number | undefined>(undefined),
      callback = useRef(onCommit),
      changing = useRef(false);
   callback.current = onCommit;
   useEffect(() => {
      if (!changing.current) {
         latest.current = value;
         setDisplay(value);
      }
   }, [value]);
   useEffect(() => () => window.clearTimeout(timer.current), []);
   const dragging = useRef(false),
      exact = useRef(false),
      input = useRef<HTMLInputElement>(null);
   const commit = (next: number) => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      const committed = revision.current;
      changing.current = true;
      void Promise.resolve(callback.current(next))
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
         (Math.abs(next - 1) / 1.41) * Math.max(1, input.current.getBoundingClientRect().width - 16) <= 5
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
               max={1.41}
               step={0.01}
               value={Math.min(display, 1.41)}
               disabled={disabled}
               onChange={(event) => change(Number(event.target.value))}
               onPointerDown={(event) => {
                  exact.current = event.shiftKey;
                  dragging.current = true;
               }}
               onPointerMove={(event) => {
                  exact.current = event.shiftKey;
               }}
               onPointerUp={() => {
                  dragging.current = false;
                  commit(latest.current);
               }}
               onPointerCancel={() => {
                  dragging.current = false;
                  commit(latest.current);
               }}
               onKeyUp={() => commit(latest.current)}
               onBlur={() => {
                  dragging.current = false;
                  if (changing.current) commit(latest.current);
               }}
               onDoubleClick={reset}
               onKeyDown={(event) => {
                  if (event.key === "Delete") {
                     event.preventDefault();
                     reset();
                  }
               }}
               title="Drag up to +3 dB. Type up to +12 dB. Double-click or Delete resets to 0 dB. Hold Shift to bypass snapping."
            />
            <span className="mixer-fader-track" aria-hidden="true">
               <span className="mixer-fader-fill" />
               <span className="mixer-fader-thumb" />
            </span>
         </span>
         <span className="mixer-gain-value">
            <input
               type="text"
               inputMode="decimal"
               aria-label={`${label} in decibels`}
               title={display <= 0 ? "Silence. Enter a dB value to restore gain." : `${gainDb(display).toFixed(2)} dB`}
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
            <span aria-hidden="true">dB</span>
         </span>
      </div>
   );
}
