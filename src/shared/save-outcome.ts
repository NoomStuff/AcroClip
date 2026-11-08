/**
 * What a finished save did, as data. Notices turn it into text in one place,
 * so richer save feedback can present the same outcomes later.
 */
export type SaveOutcome =
   { kind: "saved"; previousFootage: boolean } | { kind: "extended"; seconds: number } | { kind: "kept-both" } | { kind: "extended-previous-kept" };

function length(seconds: number): string {
   const whole = Math.max(0, Math.round(seconds));
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function saveOutcomeMessage(outcome: SaveOutcome): string {
   switch (outcome.kind) {
      case "saved":
         return outcome.previousFootage ? "Saved the footage that was still available" : "Clip saved";
      case "extended":
         return `Clip extended to ${length(outcome.seconds)}`;
      case "kept-both":
         return "Couldn't extend the previous clip, saved normally";
      case "extended-previous-kept":
         return "Clip extended. The shorter version couldn't go to the trash";
   }
}
