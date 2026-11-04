import { createContext, useContext } from "react";

// A field can contain several controls, such as a slider and its numeric input.
// Each control keeps its own name and shares the field's explanation.
export const FieldDescription = createContext<string | undefined>(undefined);

export function useFieldDescription(existing?: string): string | undefined {
   return [useContext(FieldDescription), existing].filter(Boolean).join(" ") || undefined;
}
