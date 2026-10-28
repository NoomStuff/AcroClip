import type { AppEvent, AppState } from "../shared/types";

// These fields are replaced as a whole by their owners. Mutable jobs,
// categories and recorder status must still be compared by value.
const immutableFields = new Set<keyof AppState>(["clips", "folders", "applicationIcons", "preferences"]);

export class StateChanges {
   private previous = new Map<keyof AppState, { value: unknown; json: string | undefined }>();

   reset(): void {
      this.previous.clear();
   }

   event(state: AppState): Extract<AppEvent, { type: "state" | "state-patch" }> | undefined {
      const first = this.previous.size === 0;
      const patch: Partial<AppState> = {};
      const keys = new Set([...this.previous.keys(), ...(Object.keys(state) as Array<keyof AppState>)]);
      for (const key of keys) {
         const value = state[key];
         const prior = this.previous.get(key);
         if (prior && immutableFields.has(key) && prior.value === value) continue;
         const json = JSON.stringify(value);
         if (!prior || json !== prior.json) Object.assign(patch, { [key]: value });
         this.previous.set(key, { value, json });
      }
      if (first) return { type: "state", state };
      if (Object.keys(patch).length) return { type: "state-patch", patch };
      return undefined;
   }
}
