import { useEffect, useRef, useState } from "react";
import { useFieldDescription } from "./field-accessibility";
import { SelectionIndicator } from "./SelectionIndicator";

/** Common values as one click. Custom turns its own segment into the exact field, so the row never grows. */
export function PresetNumberInput({
   label,
   inputLabel,
   presets,
   presetLabel,
   value,
   unit,
   min,
   max,
   step = 1,
   onValueChange,
}: {
   label: string;
   inputLabel: string;
   presets: readonly number[];
   presetLabel: (value: number) => string;
   value: number;
   unit: string;
   min: number;
   max: number;
   step?: number;
   onValueChange: (value: number) => void;
}) {
   const description = useFieldDescription();
   const [chosen, setChosen] = useState(false);
   const [focusField, setFocusField] = useState(false);
   const input = useRef<HTMLInputElement>(null);
   // A saved value that is not a preset, or an empty draft, opens on Custom.
   const custom = chosen || !presets.includes(value);
   useEffect(() => {
      if (!focusField) return;
      input.current?.focus();
      input.current?.select();
      setFocusField(false);
   }, [focusField]);
   return (
      // Several controls share the row, so a click on the row itself does nothing.
      <div className="segmented segmented-compact moving-selection preset-number" role="group" aria-label={`${label} choices`} data-row-ignore="">
         <SelectionIndicator value={custom ? "custom" : String(value)} selector=".selected" />
         {presets.map((preset) => (
            <button
               key={preset}
               className={!custom && value === preset ? "selected" : ""}
               aria-pressed={!custom && value === preset}
               onClick={() => {
                  setChosen(false);
                  onValueChange(preset);
               }}
            >
               {presetLabel(preset)}
            </button>
         ))}
         {custom ? (
            <label className="selected preset-number-field">
               <input
                  ref={input}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  aria-label={inputLabel}
                  aria-describedby={description}
                  value={Number.isNaN(value) ? "" : value}
                  onChange={(event) => onValueChange(event.currentTarget.valueAsNumber)}
               />
               <span aria-hidden="true">{unit}</span>
            </label>
         ) : (
            <button
               aria-pressed={false}
               onClick={() => {
                  setChosen(true);
                  setFocusField(true);
               }}
            >
               Custom
            </button>
         )}
      </div>
   );
}
