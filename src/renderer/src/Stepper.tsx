import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode, RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { useFieldDescription } from "./field-accessibility";

// Interaction reference: Better Osiris NumberField. The value bounces in the direction it moved.
function useValueBump(value: number, content: RefObject<HTMLSpanElement | null>, input: RefObject<HTMLInputElement | null>) {
   const previous = useRef(value);
   const stepped = useRef(false);
   useLayoutEffect(() => {
      const from = previous.current;
      previous.current = value;
      const node = content.current;
      // Typing already shows the change, so only steps and outside changes move.
      const typing = document.activeElement === input.current && !stepped.current;
      stepped.current = false;
      if (!node || typing || from === value || !Number.isFinite(from) || !Number.isFinite(value)) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Up for an increase, down for a decrease, then back.
      const offset = value > from ? -3 : 3;
      node.animate([{ transform: "none" }, { transform: `translateY(${offset}px) scale(1.08)`, offset: 0.35 }, { transform: "none" }], {
         duration: 260,
         easing: "cubic-bezier(0.22, 0.8, 0.3, 1)",
      });
   }, [value, content, input]);
   return () => {
      stepped.current = true;
   };
}

/** Holding a step button repeats it, faster the longer it is held. */
function useHoldRepeat(onStep: (direction: 1 | -1) => void) {
   const latest = useRef(onStep);
   const timer = useRef<number | undefined>(undefined);
   const release = useRef<(() => void) | null>(null);
   useLayoutEffect(() => {
      latest.current = onStep;
   });
   const stop = () => {
      window.clearTimeout(timer.current);
      release.current?.();
      release.current = null;
   };
   useEffect(() => stop, []);
   return {
      start(direction: 1 | -1) {
         stop();
         latest.current(direction);
         let delay = 110;
         const tick = () => {
            latest.current(direction);
            delay = Math.max(35, delay * 0.85);
            timer.current = window.setTimeout(tick, delay);
         };
         timer.current = window.setTimeout(tick, 400);
         // A button that disables at its limit stops receiving pointer events, so listen on the window.
         window.addEventListener("pointerup", stop);
         window.addEventListener("pointercancel", stop);
         window.addEventListener("blur", stop);
         release.current = () => {
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
            window.removeEventListener("blur", stop);
         };
      },
   };
}

function Stepper({
   decreaseLabel,
   increaseLabel,
   unit,
   disabled,
   canDecrease,
   canIncrease,
   onStep,
   content,
   children,
}: {
   decreaseLabel: string;
   increaseLabel: string;
   unit?: string | undefined;
   disabled?: boolean | undefined;
   canDecrease: boolean;
   canIncrease: boolean;
   onStep: (direction: 1 | -1) => void;
   content: RefObject<HTMLSpanElement | null>;
   children: ReactNode;
}) {
   const repeat = useHoldRepeat(onStep);
   return (
      <div className="stepper" data-disabled={disabled || undefined}>
         <button
            type="button"
            className="stepper-step"
            tabIndex={-1}
            aria-label={decreaseLabel}
            disabled={disabled || !canDecrease}
            onPointerDown={(event) => {
               event.preventDefault();
               if (event.button === 0) repeat.start(-1);
            }}
            onClick={(event) => {
               // A pointer press already stepped. Keyboard and assistive clicks have no detail.
               if (event.detail === 0) onStep(-1);
            }}
         >
            <Minus size={14} aria-hidden="true" />
         </button>
         <label className="stepper-value">
            <span className="stepper-content" ref={content}>
               {children}
               {unit && (
                  <span className="stepper-unit" aria-hidden="true">
                     {unit}
                  </span>
               )}
            </span>
         </label>
         <button
            type="button"
            className="stepper-step"
            tabIndex={-1}
            aria-label={increaseLabel}
            disabled={disabled || !canIncrease}
            onPointerDown={(event) => {
               event.preventDefault();
               if (event.button === 0) repeat.start(1);
            }}
            onClick={(event) => {
               // A pointer press already stepped. Keyboard and assistive clicks have no detail.
               if (event.detail === 0) onStep(1);
            }}
         >
            <Plus size={14} aria-hidden="true" />
         </button>
      </div>
   );
}

export function NumberInput({
   value,
   unit,
   onValueChange,
   inputRef,
   ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
   value: number;
   unit: string;
   onValueChange: (value: number) => void;
   inputRef?: RefObject<HTMLInputElement | null>;
}) {
   const description = useFieldDescription(props["aria-describedby"]);
   const input = useRef<HTMLInputElement>(null);
   const content = useRef<HTMLSpanElement>(null);
   const markStepped = useValueBump(value, content, input);
   const min = props.min === undefined ? -Infinity : Number(props.min);
   const max = props.max === undefined ? Infinity : Number(props.max);
   const step = Number(props.step ?? 1);
   const name = (props["aria-label"] ?? unit).toLowerCase();
   const move = (direction: 1 | -1) => {
      const base = Number.isNaN(value) ? (Number.isFinite(min) ? min : 0) : value;
      const next = Math.min(max, Math.max(min, base + direction * step));
      if (next === value) return;
      markStepped();
      onValueChange(next);
   };
   return (
      <Stepper
         decreaseLabel={`Decrease ${name}`}
         increaseLabel={`Increase ${name}`}
         unit={unit}
         disabled={props.disabled}
         canDecrease={Number.isNaN(value) || value > min}
         canIncrease={Number.isNaN(value) || value < max}
         onStep={move}
         content={content}
      >
         <input
            {...props}
            ref={(node) => {
               input.current = node;
               if (inputRef) inputRef.current = node;
            }}
            data-row-target=""
            aria-describedby={description}
            type="number"
            value={Number.isNaN(value) ? "" : value}
            onChange={(event) => onValueChange(event.currentTarget.valueAsNumber)}
            onKeyDown={(event) => {
               if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(event.key === "ArrowUp" ? 1 : -1);
               }
               props.onKeyDown?.(event);
            }}
         />
      </Stepper>
   );
}

/** A text spinbutton that keeps its own draft and commits on blur or Enter, such as a duration. */
export function DraftStepper({
   label,
   value,
   min,
   max,
   step,
   unit,
   format,
   parse,
   decreaseLabel,
   increaseLabel,
   valueText,
   onValueChange,
}: {
   label: string;
   value: number;
   min: number;
   max: number;
   step: number;
   unit?: string;
   format: (value: number) => string;
   parse: (text: string) => number | null;
   decreaseLabel: string;
   increaseLabel: string;
   valueText?: string;
   onValueChange: (value: number) => void;
}) {
   const description = useFieldDescription();
   const [draft, setDraft] = useState<string | null>(null);
   const input = useRef<HTMLInputElement>(null);
   const content = useRef<HTMLSpanElement>(null);
   const markStepped = useValueBump(value, content, input);
   const commit = (next: number) => {
      setDraft(null);
      onValueChange(Math.max(min, Math.min(max, next)));
   };
   const move = (direction: 1 | -1) => {
      markStepped();
      commit((draft === null ? value : (parse(draft) ?? value)) + direction * step);
   };
   const accept = () => {
      const next = draft === null ? null : parse(draft);
      if (next !== null) commit(next);
      else setDraft(null);
   };
   return (
      <Stepper
         decreaseLabel={decreaseLabel}
         increaseLabel={increaseLabel}
         unit={unit}
         canDecrease={value > min}
         canIncrease={value < max}
         onStep={move}
         content={content}
      >
         <input
            ref={input}
            data-row-target=""
            aria-label={label}
            aria-describedby={description}
            role="spinbutton"
            inputMode="numeric"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={valueText}
            value={draft ?? format(value)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={accept}
            onKeyDown={(event) => {
               if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  move(event.key === "ArrowUp" ? 1 : -1);
               } else if (event.key === "Enter") {
                  event.preventDefault();
                  accept();
               } else if (event.key === "Escape") setDraft(null);
            }}
         />
      </Stepper>
   );
}
