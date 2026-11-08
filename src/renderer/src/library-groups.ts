import type { Clip } from "../../shared/types";
import type { LibrarySort } from "./library-index";

export type LibraryGrouping = "none" | "date" | "application" | "watched" | "shareable";
export const libraryGroupings: readonly LibraryGrouping[] = ["none", "date", "application", "watched", "shareable"];
export interface ClipGroup {
   key: string;
   label: string;
   clips: Clip[];
}

interface Bucket {
   key: string;
   label: string;
   // Groups appear in ascending rank.
   rank: number;
}
const startOfDay = (time: number) => {
   const day = new Date(time);
   day.setHours(0, 0, 0, 0);
   return day.getTime();
};

/**
 * Dates read in the size that matters: days for this week, months after
 * that. Days use the local calendar.
 */
export function dateBucket(createdAt: number, now: Date, locale?: string): Omit<Bucket, "rank"> & { start: number } {
   const today = startOfDay(now.getTime());
   const day = Math.min(startOfDay(createdAt), today);
   const daysAgo = Math.round((today - day) / 86_400_000);
   const date = new Date(day);
   const dayKey = `day:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
   if (daysAgo === 0) return { key: dayKey, label: "Today", start: day };
   if (daysAgo === 1) return { key: dayKey, label: "Yesterday", start: day };
   if (daysAgo < 7) return { key: dayKey, label: new Intl.DateTimeFormat(locale, { weekday: "long" }).format(date), start: day };
   const month = new Date(date.getFullYear(), date.getMonth(), 1);
   const options: Intl.DateTimeFormatOptions = month.getFullYear() === now.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" };
   return {
      key: `month:${month.getFullYear()}-${month.getMonth() + 1}`,
      label: new Intl.DateTimeFormat(locale, options).format(month),
      start: month.getTime(),
   };
}

/**
 * Split already sorted clips into groups. Clips keep their order inside a
 * group. Groups follow the sort when it uses the same field, and their
 * natural order otherwise.
 */
export function groupClips(
   clips: readonly Clip[],
   grouping: LibraryGrouping,
   sort: LibrarySort,
   options: { now: Date; application: (clip: Clip) => { key: string; label: string }; locale?: string }
): ClipGroup[] {
   if (grouping === "none") return [];
   const reversed = (field: LibrarySort["field"]) => sort.field === field && sort.reversed;
   const bucket = (clip: Clip): Bucket => {
      switch (grouping) {
         case "date": {
            const { key, label, start } = dateBucket(clip.createdAt, options.now, options.locale);
            return { key, label, rank: reversed("date") ? start : -start };
         }
         case "watched":
            return clip.watched ? { key: "watched", label: "Watched", rank: 1 } : { key: "new", label: "New", rank: 0 };
         case "shareable":
            // Clips ready to send come first.
            return clip.shareables.length ? { key: "shareable", label: "Has shareable", rank: 0 } : { key: "no-shareable", label: "No shareable", rank: 1 };
         case "application": {
            const { key, label } = options.application(clip);
            return { key: `application:${key}`, label, rank: 0 };
         }
      }
   };
   const groups = new Map<string, ClipGroup & { rank: number }>();
   for (const clip of clips) {
      const { key, label, rank } = bucket(clip);
      const group = groups.get(key);
      if (group) group.clips.push(clip);
      else groups.set(key, { key, label, rank, clips: [clip] });
   }
   return [...groups.values()]
      .sort((a, b) => a.rank - b.rank || (grouping === "application" ? a.label.localeCompare(b.label) : 0))
      .map(({ key, label, clips: members }) => ({ key, label, clips: members }));
}
