import type { AppEvent, AppState, Clip, ClipChanges } from "../shared/types";

// These fields are replaced as a whole by their owners. Mutable jobs,
// categories and recorder status must still be compared by value.
const immutableFields = new Set<keyof AppState>(["folders", "applicationIcons", "preferences"]);

/**
 * Turns app snapshots into the smallest event that brings the renderer up to
 * date. A library rescan replaces every clip object, so clips are compared one
 * by one and only changed clips cross IPC. Unchanged clips keep their renderer
 * objects, which lets memoized cards skip rendering.
 */
export class StateChanges {
   private previous = new Map<keyof AppState, { value: unknown; json: string | undefined }>();
   private sentClips = new Map<string, string>();
   private sentOrder: readonly string[] = [];
   private readonly clipJson = new WeakMap<Clip, string>();

   reset(): void {
      this.previous.clear();
      this.sentClips.clear();
      this.sentOrder = [];
   }

   event(state: AppState): Extract<AppEvent, { type: "state" | "state-patch" }> | undefined {
      const first = this.previous.size === 0;
      const patch: Partial<AppState> = {};
      const keys = new Set([...this.previous.keys(), ...(Object.keys(state) as Array<keyof AppState>)]);
      keys.delete("clips");
      for (const key of keys) {
         const value = state[key];
         const prior = this.previous.get(key);
         if (prior && immutableFields.has(key) && prior.value === value) continue;
         const json = JSON.stringify(value);
         if (!prior || json !== prior.json) Object.assign(patch, { [key]: value });
         this.previous.set(key, { value, json });
      }
      const clips = this.clipChanges(state.clips);
      if (first) return { type: "state", state };
      if (Object.keys(patch).length || clips) return { type: "state-patch", patch, ...(clips ? { clips } : {}) };
      return undefined;
   }

   private clipChanges(clips: Clip[]): ClipChanges | undefined {
      if (this.previous.get("clips")?.value === clips) return undefined;
      this.previous.set("clips", { value: clips, json: undefined });
      const sent = new Map<string, string>();
      const upsert: Clip[] = [];
      for (const clip of clips) {
         let json = this.clipJson.get(clip);
         if (json === undefined) {
            json = JSON.stringify(clip);
            this.clipJson.set(clip, json);
         }
         if (this.sentClips.get(clip.id) !== json) upsert.push(clip);
         sent.set(clip.id, json);
      }
      const order = clips.map((clip) => clip.id);
      const reordered = order.length !== this.sentOrder.length || order.some((id, index) => id !== this.sentOrder[index]);
      this.sentClips = sent;
      this.sentOrder = order;
      if (reordered) return { upsert, order };
      return upsert.length ? { upsert } : undefined;
   }
}
