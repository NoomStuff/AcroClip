// Interaction reference: ppy/osu FormSliderBar and RoundedSliderBar. Implemented for native HTML inputs.
import { useEffect, useRef, useState } from "react";
import { useSliderMotion } from "./useSliderMotion";
import type { InputHTMLAttributes } from "react";

type SliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "min" | "max" | "step" | "onChange"> & {
   value: number;
   min: number;
   max: number;
   step: number;
   onValueChange: (value: number) => void;
   onCommit?: (value: number) => void;
   defaultValue?: number;
   snapPoints?: readonly number[];
   numeric?: boolean;
   unit?: string;
   displayScale?: number;
   "aria-label": string;
};
export function Slider({
   value,
   min,
   max,
   step,
   onValueChange,
   onCommit,
   defaultValue,
   snapPoints = [],
   numeric = false,
   unit = "",
   displayScale = 1,
   className = "",
   style,
   disabled,
   ...props
}: SliderProps) {
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState("");
   const pointer = useRef({ active: false, exact: false });
   const latest = useRef(value);
   useEffect(() => {
      latest.current = value;
   }, [value]);
   const bounded = (point: number) => Math.max(min, Math.min(max, point));
   const rounded = (point: number) => bounded(Number((min + Math.round((point - min) / step) * step).toFixed(8)));
   const display = String(Number((value * displayScale).toFixed(3)));
   const progress = max > min ? ((bounded(value) - min) / (max - min)) * 100 : 0;
   const markers = Array.from(new Set([...snapPoints, ...(defaultValue === undefined ? [] : [defaultValue])])).filter((point) => point > min && point < max);
   const motion = useSliderMotion<HTMLSpanElement>(progress);
   const snapped = (point: number, input: HTMLInputElement) => {
      if (!pointer.current.active || pointer.current.exact || max <= min) return point;
      const usable = Math.max(1, input.getBoundingClientRect().width - 16);
      const radius = Math.min(7, usable * 0.018);
      const closest = markers.reduce<number | undefined>(
         (best, mark) => (best === undefined || Math.abs(mark - point) < Math.abs(best - point) ? mark : best),
         undefined
      );
      return closest !== undefined && (Math.abs(closest - point) / (max - min)) * usable <= radius ? closest : point;
   };
   const change = (next: number) => {
      latest.current = next;
      onValueChange(next);
   };
   const commitNumber = (text: string) => {
      if (text.trim() && Number.isFinite(Number(text))) {
         const next = rounded(Number(text) / displayScale);
         change(next);
         onCommit?.(next);
      }
      setEditing(false);
   };
   const reset = () => {
      if (!disabled && defaultValue !== undefined) {
         change(defaultValue);
         onCommit?.(defaultValue);
      }
   };
   return (
      <span
         className={`slider ${numeric ? "slider-with-number" : ""} ${className}`}
         data-disabled={disabled || undefined}
         data-default={(defaultValue !== undefined && Math.abs(value - defaultValue) < step / 2) || undefined}
         ref={motion}
         style={style}
      >
         {numeric && (
            <span className="slider-number">
               <input
                  type="number"
                  inputMode="decimal"
                  aria-label={`${props["aria-label"]} value`}
                  min={min * displayScale}
                  max={max * displayScale}
                  step={step * displayScale}
                  value={editing ? draft : display}
                  disabled={disabled}
                  onFocus={(event) => {
                     setEditing(true);
                     setDraft(display);
                     event.currentTarget.select();
                  }}
                  onChange={(event) => {
                     const text = event.currentTarget.value;
                     setDraft(text);
                     const next = Number(text) / displayScale;
                     if (text.trim() && Number.isFinite(next) && next >= min && next <= max) change(rounded(next));
                  }}
                  onBlur={(event) => commitNumber(event.currentTarget.value)}
                  onKeyDown={(event) => {
                     if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                     }
                     if (event.key === "Escape") {
                        event.preventDefault();
                        event.currentTarget.value = display;
                        event.currentTarget.blur();
                     }
                  }}
               />
               {unit && <span aria-hidden="true">{unit}</span>}
            </span>
         )}
         <span className="slider-control">
            <input
               {...props}
               className="slider-input"
               type="range"
               min={min}
               max={max}
               step={step}
               value={value}
               disabled={disabled}
               title={
                  defaultValue === undefined
                     ? props.title
                     : `Default: ${defaultValue * displayScale}${unit}. Double-click or press Delete to reset. Hold Shift to bypass snapping.`
               }
               onChange={(event) => {
                  const next = snapped(Number(event.currentTarget.value), event.currentTarget);
                  change(next);
               }}
               onPointerDown={(event) => {
                  pointer.current = { active: true, exact: event.shiftKey };
                  props.onPointerDown?.(event);
               }}
               onPointerMove={(event) => {
                  pointer.current.exact = event.shiftKey;
                  props.onPointerMove?.(event);
               }}
               onPointerUp={(event) => {
                  const next = snapped(Number(event.currentTarget.value), event.currentTarget);
                  pointer.current.active = false;
                  change(next);
                  onCommit?.(next);
                  props.onPointerUp?.(event);
               }}
               onPointerCancel={(event) => {
                  pointer.current.active = false;
                  onCommit?.(latest.current);
                  props.onPointerCancel?.(event);
               }}
               onKeyDown={(event) => {
                  if (event.key === "Delete" && defaultValue !== undefined) {
                     event.preventDefault();
                     reset();
                  }
                  props.onKeyDown?.(event);
               }}
               onKeyUp={(event) => {
                  onCommit?.(latest.current);
                  props.onKeyUp?.(event);
               }}
               onDoubleClick={(event) => {
                  reset();
                  props.onDoubleClick?.(event);
               }}
            />
            <span className="slider-track" aria-hidden="true">
               <span className="slider-fill" />
               {markers.map((point) => (
                  <span
                     key={point}
                     className={`slider-marker ${point === defaultValue ? "default" : ""}`}
                     style={{ left: `${max > min ? ((point - min) / (max - min)) * 100 : 0}%` }}
                  />
               ))}
               <span className="slider-thumb" />
            </span>
         </span>
      </span>
   );
}
