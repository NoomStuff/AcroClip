import { CalendarDays, CaseSensitive, Clock3, Eye, Gamepad2, HardDrive, Rows3, Share2, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { defaultLibrarySort } from "./library-index";
import type { LibrarySort, LibrarySortField } from "./library-index";
import { libraryGroupings } from "./library-groups";
import type { LibraryGrouping } from "./library-groups";

export const sortFields: readonly { value: LibrarySortField; label: string; icon: LucideIcon; directions: readonly [string, string] }[] = [
   { value: "date", label: "Time", icon: Clock3, directions: ["Newest first", "Oldest first"] },
   { value: "name", label: "Name", icon: CaseSensitive, directions: ["A to Z", "Z to A"] },
   { value: "size", label: "Size", icon: HardDrive, directions: ["Largest first", "Smallest first"] },
   { value: "length", label: "Duration", icon: Timer, directions: ["Longest first", "Shortest first"] },
];
export const groupingOptions: readonly { value: LibraryGrouping; label: string; icon: LucideIcon }[] = [
   { value: "none", label: "None", icon: Rows3 },
   { value: "date", label: "Date", icon: CalendarDays },
   { value: "application", label: "Application", icon: Gamepad2 },
   { value: "watched", label: "Watched", icon: Eye },
   // The same icon as Create shareable.
   { value: "shareable", label: "Has shareable", icon: Share2 },
];

export const directionLabel = (sort: LibrarySort): string => sortFields.find((field) => field.value === sort.field)!.directions[sort.reversed ? 1 : 0];

/** The trigger only shows an icon, so its tooltip names both choices. */
export function viewSummary(sort: LibrarySort, grouping: LibraryGrouping): string {
   const group = groupingOptions.find((option) => option.value === grouping)!;
   return grouping === "none" ? `Sort: ${directionLabel(sort)}` : `Sort: ${directionLabel(sort)}. Group: ${group.label}`;
}

const storage = { sort: "acroclip.library.sort", grouping: "acroclip.library.grouping" } as const;
export function readLibraryView(): { sort: LibrarySort; grouping: LibraryGrouping } {
   const read = (key: string): unknown => {
      try {
         return JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
         return null;
      }
   };
   const sort = read(storage.sort);
   const grouping = read(storage.grouping);
   return {
      sort:
         sort &&
         typeof sort === "object" &&
         "field" in sort &&
         "reversed" in sort &&
         sortFields.some((field) => field.value === sort.field) &&
         typeof sort.reversed === "boolean"
            ? { field: sort.field as LibrarySortField, reversed: sort.reversed }
            : defaultLibrarySort,
      grouping: libraryGroupings.includes(grouping as LibraryGrouping) ? (grouping as LibraryGrouping) : "none",
   };
}
export function storeLibraryView(sort: LibrarySort, grouping: LibraryGrouping): void {
   try {
      localStorage.setItem(storage.sort, JSON.stringify(sort));
      localStorage.setItem(storage.grouping, JSON.stringify(grouping));
   } catch {
      /* Sorting and grouping still work without storage. */
   }
}
