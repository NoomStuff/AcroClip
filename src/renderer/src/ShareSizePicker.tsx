import { useEffect, useRef, useState } from "react";
import { DropdownSelect } from "./DropdownSelect";

export function ShareSizePicker({
   defaultTarget,
   target,
   override,
   disabled,
   onOverride,
   onTarget,
}: {
   defaultTarget: number;
   target: number;
   override: boolean;
   disabled: boolean;
   onOverride: (value: boolean) => void;
   onTarget: (value: number) => void;
}) {
   const [custom, setCustom] = useState(false);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState("");
   const trigger = useRef<HTMLButtonElement>(null);
   const input = useRef<HTMLInputElement>(null);
   const valid = draft.trim() !== "" && Number.isInteger(Number(draft)) && Number(draft) >= 1 && Number(draft) <= 2000;
   const commit = () => {
      if (!valid) return false;
      onTarget(Number(draft));
      onOverride(true);
      setCustom(true);
      return true;
   };
   const close = () => {
      setEditing(false);
      trigger.current?.focus();
   };
   useEffect(() => {
      if (!editing) return;
      input.current?.focus();
      input.current?.select();
   }, [editing]);
   return (
      <div
         className="viewer-size-picker"
         onPointerDown={(event) => {
            if (event.target instanceof Element && event.target.closest(".select-trigger")) setEditing(false);
         }}
         onBlur={(event) => {
            if (editing && !event.currentTarget.contains(event.relatedTarget)) {
               commit();
               setEditing(false);
            }
         }}
         onKeyDown={(event) => {
            if (!editing || !["Escape", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            // Escape discards the draft. Enter and leaving the field commit a valid value.
            if (event.key === "Escape" || commit()) close();
         }}
      >
         <DropdownSelect
            triggerRef={trigger}
            label={`Shareable size: ${override ? target : defaultTarget} MB${override ? "" : " (default)"}`}
            disabled={disabled}
            triggerContent={<span>{override ? target : defaultTarget} MB</span>}
            value={custom && override ? "custom" : String(override ? target : defaultTarget)}
            options={[
               ...Array.from(new Set([10, 20, 50, 100, defaultTarget]))
                  .sort((a, b) => a - b)
                  .map((size) => ({ value: String(size), label: `${size} MB${size === defaultTarget ? " (default)" : ""}` })),
               { value: "custom", label: "Custom" },
            ]}
            onChange={(value) => {
               if (value === "custom") {
                  setDraft(String(override ? target : defaultTarget));
                  setEditing(true);
               } else {
                  setCustom(false);
                  setEditing(false);
                  onOverride(Number(value) !== defaultTarget);
                  onTarget(Number(value));
               }
            }}
         />
         {editing && (
            <div className="viewer-size-popover">
               <label htmlFor="viewer-custom-size">Custom size</label>
               <div className="number-unit">
                  <input
                     ref={input}
                     id="viewer-custom-size"
                     type="number"
                     min={1}
                     max={2000}
                     step={1}
                     value={draft}
                     aria-label="Shareable size target in MB"
                     aria-describedby="viewer-size-range"
                     aria-invalid={!valid}
                     onChange={(event) => setDraft(event.target.value)}
                  />
                  <span>MB</span>
               </div>
               <p id="viewer-size-range" className={valid ? "muted" : "error-text"}>
                  Enter a whole number, 1 to 2000 MB.
               </p>
            </div>
         )}
      </div>
   );
}
