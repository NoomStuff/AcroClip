import type { Clip } from "../../shared/types";
import type { LibrarySort } from "./library-index";

export type LibraryGrouping = "none" | "date" | "application" | "watched" | "shared" | "size" | "length";
export const libraryGroupings: readonly LibraryGrouping[] = ["none", "date", "application", "watched", "shared", "size", "length"];
export interface ClipGroup {
   key: string;
   label: string;
   clips: Clip[];
}

const sizeSteps = [
   { below: 10e6, label: "Under 10 MB" },
   { below: 100e6, label: "10 to 100 MB" },
   { below: 500e6, label: "100 to 500 MB" },
   { below: 1e9, label: "500 MB to 1 GB" },
   { below: Infinity, label: "Over 1 GB" },
];
const lengthSteps = [
   { below: 30, label: "Under 30 seconds" },
   { below: 60, label: "30 seconds to 1 minute" },
   { below: 120, label: "1 to 2 minutes" },
   { below: 300, label: "2 to 5 minutes" },
   { below: Infinity, label: "Over 5 minutes" },
];

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
         case "size":
         case "length": {
            const steps = grouping === "size" ? sizeSteps : lengthSteps;
            const index = steps.findIndex((step) => (grouping === "size" ? clip.size : clip.duration) < step.below);
            return { key: `${grouping}:${index}`, label: steps[index]!.label, rank: reversed(grouping) ? index : -index };
         }
         case "watched":
            return clip.watched ? { key: "watched", label: "Watched", rank: 1 } : { key: "new", label: "New", rank: 0 };
         case "shared":
            return clip.shared ? { key: "shared", label: "Shared", rank: 1 } : { key: "unshared", label: "Not shared yet", rank: 0 };
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
