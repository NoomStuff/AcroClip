import { describe, expect, it } from "vitest";
import type { Clip } from "../../shared/types";
import { compareClips } from "./library-index";
import type { LibrarySort } from "./library-index";
import { dateBucket, groupClips } from "./library-groups";

const now = new Date(2026, 10, 8, 21, 0);
const at = (days: number, hours = 12) => new Date(2026, 10, 8 - days, hours).getTime();
const clip = (id: string, overrides: Partial<Clip> = {}): Clip => ({
   id,
   path: `/clips/${id}.mp4`,
   relativePath: `${id}.mp4`,
   name: id,
   source: "Game",
   size: 50e6,
   duration: 60,
   width: 1920,
   height: 1080,
   createdAt: at(0),
   thumbnail: "",
   playbackUrl: "",
   tracks: [],
   categories: [],
   shareables: [],
   ...overrides,
});
const newest: LibrarySort = { field: "date", reversed: false };
const options = { now, locale: "en-US", application: (item: Clip) => ({ key: item.source.toLowerCase(), label: item.source }) };
const labels = (clips: Clip[], grouping: Parameters<typeof groupClips>[1], sort = newest) =>
   groupClips([...clips].sort(compareClips(sort)), grouping, sort, options).map((group) => [group.label, group.clips.map((item) => item.id)]);

describe("library grouping", () => {
   it("uses days for this week and months before that", () => {
      expect(dateBucket(at(0), now, "en-US").label).toBe("Today");
      expect(dateBucket(at(1, 23), now, "en-US").label).toBe("Yesterday");
      expect(dateBucket(at(2), now, "en-US").label).toBe("Friday");
      expect(dateBucket(at(6), now, "en-US").label).toBe("Monday");
      expect(dateBucket(at(7), now, "en-US").label).toBe("November");
      expect(dateBucket(new Date(2026, 0, 3).getTime(), now, "en-US").label).toBe("January");
      expect(dateBucket(new Date(2025, 11, 31).getTime(), now, "en-US").label).toBe("December 2025");
      // A clock that ran ahead still lands today.
      expect(dateBucket(at(-1), now, "en-US").label).toBe("Today");
   });
   it("orders date groups with the sort direction", () => {
      const clips = [clip("today"), clip("yesterday", { createdAt: at(1) }), clip("october", { createdAt: new Date(2026, 9, 2).getTime() })];
      expect(labels(clips, "date")).toEqual([
         ["Today", ["today"]],
         ["Yesterday", ["yesterday"]],
         ["October", ["october"]],
      ]);
      expect(labels(clips, "date", { field: "date", reversed: true }).map(([label]) => label)).toEqual(["October", "Yesterday", "Today"]);
      // Another sort keeps newest groups first and sorts inside each group.
      expect(labels([clip("b"), clip("a")], "date", { field: "name", reversed: false })).toEqual([["Today", ["a", "b"]]]);
   });
   it("puts new clips first and clips with a shareable first", () => {
      const ready = { id: "s", path: "/clips/s.mp4", relativePath: "s.mp4", size: 1, targetMB: 10, createdAt: 0 };
      const clips = [clip("seen", { watched: true, shareables: [ready] }), clip("fresh")];
      expect(labels(clips, "watched")).toEqual([
         ["New", ["fresh"]],
         ["Watched", ["seen"]],
      ]);
      expect(labels(clips, "shareable")).toEqual([
         ["Has shareable", ["seen"]],
         ["No shareable", ["fresh"]],
      ]);
   });
   it("puts the most recently played application first", () => {
      const clips = [
         clip("z", { source: "Zelda", createdAt: at(0) }),
         clip("a", { source: "Apex", createdAt: at(1) }),
         clip("a2", { source: "Apex", createdAt: at(3) }),
      ];
      expect(labels(clips, "application")).toEqual([
         ["Zelda", ["z"]],
         ["Apex", ["a", "a2"]],
      ]);
   });
   it("groups folders in tree order with the collection's own clips first", () => {
      const clips = [
         clip("deep", { relativePath: "Games/Finals/deep.mp4" }),
         clip("root", { relativePath: "root.mp4" }),
         clip("game", { relativePath: "Games/game.mp4" }),
      ];
      expect(labels(clips, "folder")).toEqual([
         ["Collection", ["root"]],
         ["Games", ["game"]],
         ["Games / Finals", ["deep"]],
      ]);
   });
   it("files a clip under its highest sidebar tag, with untagged clips last", () => {
      const tags = [
         { id: "best", name: "Best" },
         { id: "funny", name: "Funny" },
      ];
      const clips = [clip("both", { categories: ["funny", "best"] }), clip("plain"), clip("funny", { categories: ["funny"] })];
      expect(
         groupClips([...clips].sort(compareClips(newest)), "tag", newest, { ...options, tags }).map((group) => [
            group.label,
            group.clips.map((item) => item.id),
         ])
      ).toEqual([
         ["Best", ["both"]],
         ["Funny", ["funny"]],
         ["Untagged", ["plain"]],
      ]);
   });
   it("leaves the library flat without grouping", () => {
      expect(groupClips([clip("a")], "none", newest, options)).toEqual([]);
   });
});

describe("library sorting", () => {
   it("sorts each field in its natural direction and reverses it", () => {
      const clips = [
         clip("b", { size: 1, duration: 9, createdAt: at(1) }),
         clip("a", { size: 3, duration: 1, createdAt: at(2) }),
         clip("c", { size: 2, duration: 5 }),
      ];
      const order = (sort: LibrarySort) => [...clips].sort(compareClips(sort)).map((item) => item.id);
      expect(order({ field: "date", reversed: false })).toEqual(["c", "b", "a"]);
      expect(order({ field: "name", reversed: false })).toEqual(["a", "b", "c"]);
      expect(order({ field: "size", reversed: false })).toEqual(["a", "c", "b"]);
      expect(order({ field: "length", reversed: false })).toEqual(["b", "c", "a"]);
      expect(order({ field: "length", reversed: true })).toEqual(["a", "c", "b"]);
   });
});
