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
   const root = useRef<HTMLDivElement>(null);
   const trigger = useRef<HTMLButtonElement>(null);
   const input = useRef<HTMLInputElement>(null);
   const close = () => {
      setEditing(false);
      trigger.current?.focus();
   };
   useEffect(() => {
      if (!editing) return;
      input.current?.focus();
      input.current?.select();
      const dismiss = (event: PointerEvent) => {
         if (!root.current?.contains(event.target as Node)) setEditing(false);
      };
      document.addEventListener("pointerdown", dismiss);
      return () => document.removeEventListener("pointerdown", dismiss);
   }, [editing]);
   return (
      <div
         className="viewer-size-picker"
         ref={root}
         onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false);
         }}
         onKeyDown={(event) => {
            if (!editing || !["Escape", "Enter"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            close();
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
               setCustom(value === "custom");
               onOverride(value === "custom" || Number(value) !== defaultTarget);
               if (value === "custom") setEditing(true);
               else {
                  setEditing(false);
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
                     value={target}
                     aria-label="Shareable size target in MB"
                     onChange={(event) => onTarget(Math.max(1, Math.min(2000, Number(event.target.value))))}
                  />
                  <span>MB</span>
               </div>
            </div>
         )}
      </div>
   );
}
