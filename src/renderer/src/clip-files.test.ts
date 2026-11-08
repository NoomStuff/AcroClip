import { describe, expect, it } from "vitest";
import type { Clip } from "../../shared/types";
import { clipFileLabel, clipFiles, copiedMessage, defaultClipFile } from "./clip-files";

const clip = (overrides: Partial<Clip> = {}): Clip => ({
   id: "clip",
   path: "/clips/moment.mp4",
   relativePath: "moment.mp4",
   name: "moment",
   source: "Game",
   size: 245_000_000,
   duration: 60,
   width: 1920,
   height: 1080,
   createdAt: 0,
   thumbnail: "",
   playbackUrl: "",
   tracks: [],
   categories: [],
   shareables: [],
   ...overrides,
});
const shareable = (id: string, size: number) => ({ id, path: `/clips/shareables/${id}.mp4`, relativePath: `${id}.mp4`, size, targetMB: 20, createdAt: 0 });

describe("clip files", () => {
   it("names the clip and its shareables the way the player does", () => {
      const files = clipFiles(clip({ shareables: [shareable("a", 19_400_000), shareable("b", 9_800_000)] }));
      expect(clipFileLabel(files.original)).toBe("Clip · 245.0 MB");
      expect(files.shareables.map(clipFileLabel)).toEqual(["Shareable 1 · 19.4 MB", "Shareable 2 · 9.8 MB"]);
      expect(copiedMessage(files.shareables[0]!)).toBe("Copied shareable 1 · 19.4 MB");
   });
   it("prefers the newest shareable, then the clip", () => {
      expect(defaultClipFile(clip())?.path).toBe("/clips/moment.mp4");
      expect(defaultClipFile(clip({ shareables: [shareable("a", 1), shareable("b", 2)] }))?.path).toBe("/clips/shareables/b.mp4");
      expect(defaultClipFile(clip({ originalMissing: true }))).toBeUndefined();
      expect(clipFiles(clip({ originalMissing: true })).original.available).toBe(false);
   });
});
