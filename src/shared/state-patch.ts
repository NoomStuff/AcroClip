import type { AppEvent, AppState, Clip } from "./types";

/** Applies a patch to the renderer's state. Undefined means the renderer missed a clip and must reload state. */
export function applyStatePatch(current: AppState, event: Extract<AppEvent, { type: "state-patch" }>): AppState | undefined {
   const next = { ...current, ...event.patch };
   if (!event.clips) return next;
   const changed = new Map(event.clips.upsert.map((clip) => [clip.id, clip]));
   if (!event.clips.order) {
      // Same clips in the same order: replace changed ones in place.
      let replaced = 0;
      const clips = current.clips.map((clip) => {
         const update = changed.get(clip.id);
         if (update) replaced++;
         return update ?? clip;
      });
      return replaced === changed.size ? { ...next, clips } : undefined;
   }
   const known = new Map(current.clips.map((clip) => [clip.id, clip]));
   const clips: Clip[] = [];
   for (const id of event.clips.order) {
      const clip = changed.get(id) ?? known.get(id);
      if (!clip) return undefined;
      clips.push(clip);
   }
   return { ...next, clips };
}
