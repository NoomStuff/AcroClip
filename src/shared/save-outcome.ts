/**
 * What a finished save did, as data. Notices turn it into text in one place,
 * so richer save feedback can present the same outcomes later.
 */
export type SaveOutcome =
   /** `secondsSinceCapture` is how long before the save request the clip ends. */
   | { kind: "saved"; previousFootage: boolean; secondsSinceCapture: number }
   | { kind: "extended"; seconds: number; added: number }
   | { kind: "kept-both" }
   | { kind: "extended-previous-kept" };

export interface SaveNotice {
   message: string;
   detail?: string;
}

/** How long ago, for a clip that ends before the save request. */
function ago(seconds: number): string {
   return seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`;
}

function length(seconds: number): string {
   const whole = Math.max(0, Math.round(seconds));
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The banner while a save is in flight. A save that will extend the last clip says so up front. */
export function savingNotice(extendTo?: number): string {
   return extendTo === undefined ? "Saving clip…" : `Extending clip to ${length(extendTo)}`;
}

/** The title says what the collection now holds. The detail, when there is one, says how it got there. */
export function saveOutcomeNotice(outcome: SaveOutcome): SaveNotice {
   switch (outcome.kind) {
      case "saved":
         return outcome.previousFootage
            ? { message: `Saved up to ${ago(outcome.secondsSinceCapture)} ago`, detail: "Nothing was captured after that." }
            : { message: "Clip saved" };
      case "extended":
         return { message: `Clip extended to ${length(outcome.seconds)}`, detail: `Added ${length(outcome.added)} to the previous clip` };
      case "kept-both":
         return { message: "Saved as a separate clip", detail: "The previous clip couldn't be extended, so both are in your library." };
      case "extended-previous-kept":
         return { message: "Clip extended", detail: "The shorter version couldn't go to the trash, so it's still in your library." };
   }
}
