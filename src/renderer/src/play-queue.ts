import type { Clip } from "../../shared/types";
import { compareClips } from "./library-index";
import type { LibrarySort } from "./library-index";

/** The clips the player steps through, frozen when a clip opens from a library view. */
export interface PlayQueue {
   ids: string[];
   // Names the view, such as a tag, a folder or a search.
   label: string;
}
export interface QueuePosition {
   label: string;
   index: number;
   total: number;
   previous: Clip | undefined;
   next: Clip | undefined;
}

/** Previous restarts the clip once it has played this long, like a music player. */
export const restartThreshold = 3;

/** Keep the captured order while dropping deleted clips. A clip opened outside that order uses the library's saved sort. */
export function resolveQueue(clips: readonly Clip[], queue: PlayQueue | null, sort: LibrarySort): (clip: Clip) => QueuePosition {
   const byId = new Map(clips.map((clip) => [clip.id, clip]));
   const indexQueue = (items: Clip[], label: string) => ({
      items,
      label,
      positions: new Map(items.map((item, index) => [item.id, index])),
   });
   const captured =
      queue &&
      indexQueue(
         queue.ids.map((id) => byId.get(id)).filter((item): item is Clip => !!item),
         queue.label
      );
   let collection: ReturnType<typeof indexQueue> | undefined;
   return (clip) => {
      const current = captured?.positions.has(clip.id) ? captured : (collection ??= indexQueue([...clips].sort(compareClips(sort)), "All clips"));
      const index = current.positions.get(clip.id) ?? 0;
      return { label: current.label, index, total: current.items.length, previous: current.items[index - 1], next: current.items[index + 1] };
   };
}
