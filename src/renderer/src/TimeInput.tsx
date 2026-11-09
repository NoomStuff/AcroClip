import { DraftStepper } from "./Stepper";

export function durationText(seconds: number): string {
   return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const unitSeconds: Record<string, number> = {
   h: 3600,
   hr: 3600,
   hrs: 3600,
   hour: 3600,
   hours: 3600,
   m: 60,
   min: 60,
   mins: 60,
   minute: 60,
   minutes: 60,
   s: 1,
   sec: 1,
   secs: 1,
   second: 1,
   seconds: 1,
};
/**
 * Reads a duration the way people type one. A bare number is minutes ("2", "1.5"),
 * colons count up from seconds ("1:30", "1:5", "0:90", "1:00:00"), and units can be
 * mixed ("90s", "2 min", "1m 30", "1h 5m"). A unitless number after a unit takes the next smaller unit.
 */
export function parseDuration(text: string): number | null {
   const input = text.trim().toLowerCase().replace(",", ".");
   let seconds: number;
   if (!input) return null;
   if (/^\d*\.?\d+$/.test(input)) seconds = Number(input) * 60;
   else if (/^\d*(?::\d*){1,2}$/.test(input)) seconds = input.split(":").reduce((total, part) => total * 60 + Number(part || 0), 0);
   else {
      const tokens = [...input.matchAll(/(\d*\.?\d+)\s*([a-z]*)\s*/g)];
      if (!tokens.length || tokens.map((token) => token[0]).join("") !== input.replace(/^\s+/, "")) return null;
      seconds = 0;
      let previous = 0;
      for (const [, amount, unit] of tokens) {
         const scale = unit ? unitSeconds[unit] : previous === 3600 ? 60 : previous === 60 ? 1 : previous ? undefined : 60;
         if (!scale) return null;
         seconds += Number(amount) * scale;
         previous = scale;
      }
   }
   const value = Math.round(seconds);
   return Number.isSafeInteger(value) && value >= 0 ? value : null;
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
   return (
      <DraftStepper
         label={label}
         value={value}
         min={min}
         max={max}
         step={5}
         format={durationText}
         parse={parseDuration}
         valueText={durationText(value)}
         decreaseLabel={`Decrease ${label.toLowerCase()} by 5 seconds`}
         increaseLabel={`Increase ${label.toLowerCase()} by 5 seconds`}
         onValueChange={onValueChange}
      />
   );
}
