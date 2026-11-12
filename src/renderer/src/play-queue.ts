import type { Clip } from "../../shared/types";
import { selectLibraryClips } from "./library-index";
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

/** Every clip in the library's saved sort, for clips opened from outside a library view. */
function collectionQueue(clips: readonly Clip[], sort: LibrarySort): PlayQueue {
   return {
      ids: selectLibraryClips(clips, { search: "", filter: "all", folderPath: null, sort, applications: new Map() }).map((clip) => clip.id),
      label: "All clips",
   };
}

/**
 * Where a clip sits in its queue. Deleted clips drop out, new saves stay out until the next
 * library open, and a clip missing from the queue falls back to the whole collection.
 */
export function queuePosition(clip: Clip, clips: readonly Clip[], queue: PlayQueue | null, sort: LibrarySort): QueuePosition {
   const byId = new Map(clips.map((item) => [item.id, item]));
   const present = (candidate: PlayQueue) => candidate.ids.map((id) => byId.get(id)).filter((item): item is Clip => !!item);
   let items = queue ? present(queue) : [];
   let label = queue?.label ?? "";
   if (!items.some((item) => item.id === clip.id)) {
      const fallback = collectionQueue(clips, sort);
      items = present(fallback);
      label = fallback.label;
   }
   const index = Math.max(
      0,
      items.findIndex((item) => item.id === clip.id)
   );
   return { label, index, total: items.length, previous: items[index - 1], next: items[index + 1] };
}
