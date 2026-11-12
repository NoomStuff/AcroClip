import { CalendarDays, CaseSensitive, Clock3, Eye, Folder, Gamepad2, HardDrive, Rows3, Share2, Tag, Timer } from "lucide-react";
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
   { value: "folder", label: "Folder", icon: Folder },
   { value: "tag", label: "Tag", icon: Tag },
   { value: "watched", label: "Watched", icon: Eye },
   // The same icon as Create shareable.
   { value: "shareable", label: "Has shareable", icon: Share2 },
];

const directionLabel = (sort: LibrarySort): string => sortFields.find((field) => field.value === sort.field)!.directions[sort.reversed ? 1 : 0];

/** The trigger only shows an icon, so its tooltip names both choices. */
export function viewSummary(sort: LibrarySort, grouping: LibraryGrouping): string {
   const group = groupingOptions.find((option) => option.value === grouping)!;
   return grouping === "none" ? `Sort: ${directionLabel(sort)}` : `Sort: ${directionLabel(sort)}. Group: ${group.label}`;
}

const storage = { sort: "acroclip.library.sort", grouping: "acroclip.library.grouping", folded: "acroclip.library.folded" } as const;
/** Folded groups, remembered per grouping like the sidebar's folded sections. */
export function readFoldedGroups(): Partial<Record<LibraryGrouping, string[]>> {
   try {
      const value: unknown = JSON.parse(localStorage.getItem(storage.folded) ?? "{}");
      if (!value || typeof value !== "object") return {};
      return Object.fromEntries(
         Object.entries(value).filter(
            ([grouping, keys]) => libraryGroupings.includes(grouping as LibraryGrouping) && Array.isArray(keys) && keys.every((key) => typeof key === "string")
         )
      ) as Partial<Record<LibraryGrouping, string[]>>;
   } catch {
      return {};
   }
}
export function storeFoldedGroups(folded: Partial<Record<LibraryGrouping, string[]>>): void {
   try {
      localStorage.setItem(storage.folded, JSON.stringify(folded));
   } catch {
      /* Folding still works without storage. */
   }
}
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
