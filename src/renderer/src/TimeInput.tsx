import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export function durationText(seconds: number): string {
   return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function parseDuration(text: string): number | null {
   const match = /^(\d+):([0-5]\d)$/.exec(text.trim());
   if (!match) return null;
   const value = Number(match[1]) * 60 + Number(match[2]);
   return Number.isSafeInteger(value) ? value : null;
}
export function TimeInput({
   label,
   value,
   min,
   max,
   onValueChange,
}: {
   label: string;
   value: number;
   min: number;
   max: number;
   onValueChange: (value: number) => void;
}) {
   const [draft, setDraft] = useState<string | null>(null);
   const commit = (next: number) => {
      setDraft(null);
      onValueChange(Math.max(min, Math.min(max, next)));
   };
   const step = (direction: number) => commit((draft === null ? value : (parseDuration(draft) ?? value)) + direction * 5);
   const accept = () => {
      const next = draft === null ? null : parseDuration(draft);
      if (next !== null) commit(next);
      else setDraft(null);
   };
   return (
      <div className="time-input">
         <input
            aria-label={label}
            role="spinbutton"
            inputMode="numeric"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={durationText(value)}
            value={draft ?? durationText(value)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={accept}
            onKeyDown={(event) => {
               if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  step(event.key === "ArrowUp" ? 1 : -1);
               } else if (event.key === "Enter") {
                  event.preventDefault();
                  accept();
               } else if (event.key === "Escape") setDraft(null);
            }}
         />
         <span>
            <button
               type="button"
               aria-label={`Increase ${label.toLowerCase()} by 5 seconds`}
               onPointerDown={(event) => event.preventDefault()}
               onClick={() => step(1)}
            >
               <ChevronUp size={12} />
            </button>
            <button
               type="button"
               aria-label={`Decrease ${label.toLowerCase()} by 5 seconds`}
               onPointerDown={(event) => event.preventDefault()}
               onClick={() => step(-1)}
            >
               <ChevronDown size={12} />
            </button>
         </span>
      </div>
   );
}
