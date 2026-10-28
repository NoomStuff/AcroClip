import { describe, expect, it } from "vitest";
import { groupFolders, summarizeClips } from "./library-index";
import type { Clip } from "../../shared/types";

describe("library indexes", () => {
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
});
