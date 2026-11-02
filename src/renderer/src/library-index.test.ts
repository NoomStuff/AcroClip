import { describe, expect, it } from "vitest";
import { applicationKeys, orderLibrarySections, groupFolders, summarizeClips, visibleFolderRows } from "./library-index";
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

it("keeps populated sections above empty ones while preserving their saved order", () => {
   const order = ["folders", "tags", "applications"];
   const populated = { tags: false, applications: false, folders: false };
   expect(orderLibrarySections(populated, order).map((section) => section.id)).toEqual(order);
   expect(orderLibrarySections({ ...populated, applications: true }, order).map((section) => section.id)).toEqual(["applications", "folders", "tags"]);
   expect(orderLibrarySections({ ...populated, tags: true, applications: true }, order).map((section) => section.id)).toEqual([
      "tags",
      "applications",
      "folders",
   ]);
   expect(orderLibrarySections({ tags: true, applications: true, folders: true }, order).map((section) => section.id)).toEqual(order);
});
