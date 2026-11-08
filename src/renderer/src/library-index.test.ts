import { describe, expect, it } from "vitest";
import {
   applicationKeys,
   orderLibrarySections,
   groupFolders,
   summarizeClips,
   visibleFolderRows,
   summarizeFolders,
   selectChildFolders,
   selectLibraryClips,
} from "./library-index";
import type { Clip } from "../../shared/types";

describe("library indexes", () => {
   it("groups legacy app captions with the same identified application", () => {
      const keys = applicationKeys([
         { id: "known", source: "Explorer", applicationId: "explorer" },
         { id: "legacy", source: "Downloads \u2500 File Explorer" },
         { id: "screen", source: "Screen 2" },
         { id: "desktop", source: "Desktop" },
         { id: "other", source: "Other" },
      ] as Clip[]);
      expect(keys.has("screen")).toBe(false);
      expect(keys.has("desktop")).toBe(false);
      expect(keys.get("legacy")).toBe(keys.get("known"));
      expect(keys.get("other")).not.toBe(keys.get("known"));
   });
   it("preserves folder order and direct parent relationships", () => {
      expect([...groupFolders(["Games", "Games/B", "Games/A", "Other", "Games/A/Saved"])]).toEqual([
         ["", ["Games", "Other"]],
         ["Games", ["Games/B", "Games/A"]],
         ["Games/A", ["Games/A/Saved"]],
      ]);
   });
   it("counts each clip once per category and includes all original sizes", () => {
      const clips = [
         { size: 10, categories: ["a", "a", "b"] },
         { size: 30, categories: ["b"] },
         { size: 20, categories: [] },
      ] as Clip[];
      const summary = summarizeClips(clips);
      expect(summary.size).toBe(60);
      expect([...summary.categories]).toEqual([
         ["a", 1],
         ["b", 2],
      ]);
      expect(summarizeClips([])).toEqual({ size: 0, categories: new Map() });
   });
   it("flattens only expanded folders while preserving tree levels and sibling positions", () => {
      const folders = groupFolders(["Games", "Games/A", "Games/A/Saved", "Games/B", "Other"]);
      expect(visibleFolderRows(folders, new Set()).map((row) => row.id)).toEqual(["Games", "Other"]);
      const expanded = visibleFolderRows(folders, new Set(["Games", "Games/A"]));
      expect(expanded.map((row) => [row.id, row.level, row.position, row.siblings])).toEqual([
         ["Games", 1, 1, 2],
         ["Games/A", 2, 1, 2],
         ["Games/A/Saved", 3, 1, 1],
         ["Games/B", 2, 2, 2],
         ["Other", 1, 2, 2],
      ]);
      expect(visibleFolderRows(folders, new Set(["Games/A"])).map((row) => row.id)).toEqual(["Games", "Other"]);
      expect(visibleFolderRows(new Map(), new Set())).toEqual([]);
   });
});

it("preserves section order regardless of which sections are populated", () => {
   const order = ["folders", "tags", "applications"];
   for (const tags of [false, true])
      for (const applications of [false, true])
         for (const folders of [false, true]) {
            expect(orderLibrarySections({ tags, applications, folders }, order).map((section) => section.id)).toEqual(order);
         }
   expect(orderLibrarySections({ tags: false, applications: false, folders: true }, []).map((section) => section.id)).toEqual([
      "tags",
      "applications",
      "folders",
   ]);
});

const sampleClip = (id: string, relativePath: string, createdAt: number): Clip => ({
   id,
   name: id,
   path: relativePath,
   relativePath,
   source: "Game",
   size: 1000,
   duration: 30,
   width: 640,
   height: 360,
   createdAt,
   thumbnail: "",
   playbackUrl: "",
   tracks: [],
   shareables: [],
   categories: [],
});

it("counts nested folders across path separators while filtering only direct clips", () => {
   const clips = [sampleClip("Root", "Root.mp4", 1), sampleClip("Warmup", "Games\\Warmup.mp4", 5), sampleClip("Winner", "Games/Finals/Winner.mp4", 10)];
   const summaries = summarizeFolders(clips, "winner");
   expect(summaries.get("Games")).toEqual({ count: 2, matchingCount: 1, matches: true, newest: 10, oldest: 5, size: 2000, duration: 60 });
   expect(summaries.get("")?.count).toBe(3);
   expect(selectChildFolders(["Games", "Games/Finals", "Empty"], "Games", "winner", summaries, { field: "date", reversed: false })).toEqual(["Games/Finals"]);
   expect(selectChildFolders(["Games"], null, "", summaries, { field: "name", reversed: false })).toEqual([]);
   expect(
      selectLibraryClips(clips, {
         search: "",
         filter: "folder:Games",
         folderPath: "Games",
         sort: { field: "date", reversed: false },
         applications: new Map(),
      }).map(({ id }) => id)
   ).toEqual(["Warmup"]);
});

it("combines search, tags and application filters without mutating collection order", () => {
   const clips = [sampleClip("First", "First.mp4", 1), sampleClip("Second", "Second.mp4", 2)];
   clips[1]!.categories = ["best"];
   const options = {
      search: "game",
      folderPath: null,
      sort: { field: "date", reversed: false },
      applications: new Map([
         ["First", "app-a"],
         ["Second", "app-b"],
      ]),
   } as const;
   expect(selectLibraryClips(clips, { ...options, filter: "all" }).map(({ id }) => id)).toEqual(["Second", "First"]);
   expect(selectLibraryClips(clips, { ...options, filter: "category:best" }).map(({ id }) => id)).toEqual(["Second"]);
   expect(selectLibraryClips(clips, { ...options, filter: "source:app-a" }).map(({ id }) => id)).toEqual(["First"]);
   expect(clips.map(({ id }) => id)).toEqual(["First", "Second"]);
});
