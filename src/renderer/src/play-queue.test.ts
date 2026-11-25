import { describe, expect, it } from "vitest";
import type { Clip } from "../../shared/types";
import { resolveQueue } from "./play-queue";
import { defaultLibrarySort } from "./library-index";

const clip = (id: string, createdAt: number): Clip => ({
   id,
   name: id,
   source: "",
   path: `/c/${id}.mp4`,
   relativePath: `${id}.mp4`,
   size: 1,
   duration: 10,
   width: 1920,
   height: 1080,
   createdAt,
   thumbnail: "",
   playbackUrl: "",
   tracks: [],
   categories: [],
   shareables: [],
});
const clips = [clip("a", 5), clip("b", 4), clip("c", 3), clip("d", 2)];

describe("resolveQueue", () => {
   it("steps through the queue it was opened from", () => {
      const position = resolveQueue(clips, { ids: ["d", "c", "a"], label: "Ranked" }, defaultLibrarySort)(clips[2]!);
      expect(position).toMatchObject({ label: "Ranked", index: 1, total: 3 });
      expect([position.previous?.id, position.next?.id]).toEqual(["d", "a"]);
   });
   it("drops deleted clips and leaves new saves out", () => {
      const position = resolveQueue(
         [clip("new", 9), ...clips.filter((item) => item.id !== "c")],
         { ids: ["d", "c", "a"], label: "Ranked" },
         defaultLibrarySort
      )(clips[0]!);
      expect(position).toMatchObject({ index: 1, total: 2 });
      expect(position.previous?.id).toBe("d");
      expect(position.next).toBeUndefined();
   });
   it("falls back to the whole collection in the saved sort", () => {
      const position = resolveQueue(clips, null, { field: "date", reversed: true })(clips[1]!);
      expect(position).toMatchObject({ label: "All clips", index: 2, total: 4 });
      expect([position.previous?.id, position.next?.id]).toEqual(["c", "a"]);
   });
});
