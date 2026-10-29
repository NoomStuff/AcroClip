import { describe, expect, it, vi } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, symlink, mkdtemp, rm, writeFile, readFile, stat, utimes, realpath, rename } from "node:fs/promises";
import os from "node:os";
import { CollectionService, withinRoot } from "./collection";
import { previewFilename } from "../shared/filename";
import { defaultPreferences } from "../shared/defaults";
import type * as fileOperations from "node:fs/promises";
import type * as mediaOperations from "./media";

const io = vi.hoisted(() => ({ identities: 0, writes: 0, exported: [] as string[], beforeProbe: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (original) => {
   const fs = await original<typeof fileOperations>();
   return {
      ...fs,
      open: async (...args: Parameters<typeof fs.open>) => {
         if (args[1] === "r") io.identities++;
         if (args[1] === "wx") io.writes++;
         return fs.open(...args);
      },
   };
});
vi.mock("./media", async (original) => {
   const media = await original<typeof mediaOperations>();
   return {
      ...media,
      probe: async () => {
         await io.beforeProbe?.();
         return { duration: 10, width: 640, height: 360, frameRate: 30, videoCodec: "h264", tracks: [] };
      },
      runMedia: async (_name: string, args: string[]) => {
         await writeFile(args.at(-1)!, "fixture thumbnail");
         return "";
      },
      encodeShareable: async (source: string, output: string) => {
         io.exported.push(source);
         await writeFile(output, `shareable of ${source}`);
      },
   };
});

describe("damaged metadata action identity", () => {
   it("retains separate identities for identical copies while recovering a moved original", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-identical-copies-"));
      try {
         const original = join(root, "original.mp4");
         const copy = join(root, "copy.mp4");
         await writeFile(original, "identical file content");
         await writeFile(copy, "identical file content");
         const collection = new CollectionService();
         await collection.open(root);
         const originalId = collection.clips.find((clip) => clip.path === original)!.id;
         const copyId = collection.clips.find((clip) => clip.path === copy)!.id;
         expect(copyId).not.toBe(originalId);
         await collection.createCategory("Saved association");
         const categoryId = collection.categories[0]!.id;
         await collection.assignCategories(originalId, [categoryId]);
         const moved = join(root, "moved.mp4");
         await rename(original, moved);
         await collection.scan();
         expect(collection.clips.find((clip) => clip.path === moved)).toMatchObject({ id: originalId, categories: [categoryId] });
         expect(collection.clips.find((clip) => clip.path === copy)).toMatchObject({ id: copyId, categories: [] });
         expect(collection.clips).toHaveLength(2);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });

   it("keeps verified shareables and categories accessible when their original disappears, then restores the same clip", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-missing-original-"));
      try {
         const original = join(root, "Moment.mp4");
         await writeFile(original, "original moment");
         const collection = new CollectionService();
         await collection.open(root);
         const id = collection.clips[0]!.id;
         await collection.createCategory("Best moments");
         await collection.assignCategories(id, [collection.categories[0]!.id]);
         await collection.createShareable(id, 1);
         const share = collection.clips[0]!.shareables[0]!;
         const shareBytes = await readFile(share.path);
         await rm(original);
         await collection.scan();
         expect(collection.clips).toHaveLength(1);
         const missing = collection.clips[0]!;
         expect(missing.id).toBe(id);
         expect(missing.originalMissing).toBe(true);
         expect(missing.categories).toEqual([collection.categories[0]!.id]);
         expect(missing.shareables).toEqual([share]);
         expect(await collection.playback(share.path)).toMatch(/^file:/);
         expect(await collection.filesForDeletion(id)).toEqual([share.path]);
         await expect(collection.createShareable(id, 1)).rejects.toThrow("original is missing");
         const reopened = new CollectionService();
         await reopened.open(root);
         expect(reopened.clips[0]?.id).toBe(id);
         expect(reopened.clips[0]?.originalMissing).toBe(true);
         await writeFile(original, "original moment");
         await reopened.scan();
         expect(reopened.clips[0]?.id).toBe(id);
         expect(reopened.clips[0]?.originalMissing).toBeUndefined();
         expect(reopened.clips[0]?.categories).toEqual(missing.categories);
         expect(reopened.clips[0]?.shareables).toEqual([share]);
         expect(await readFile(share.path)).toEqual(shareBytes);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("recovers duplicate IDs before displayed A can rename, delete or export B", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-duplicate-ids-"));
      try {
         const a = join(root, "A.mp4");
         const b = join(root, "B.mp4");
         await writeFile(a, "original A");
         await writeFile(b, "original B");
         const collection = new CollectionService();
         await collection.open(root);
         const metadata = join(root, ".acroclip", "collection.json");
         const valid = await readFile(metadata, "utf8");
         const damaged = JSON.parse(valid) as { clips: { id: string; relativePath: string }[] };
         const recordA = damaged.clips.find((clip) => clip.relativePath === "A.mp4")!;
         const recordB = damaged.clips.find((clip) => clip.relativePath === "B.mp4")!;
         recordA.id = recordB.id;
         damaged.clips = [recordB, recordA];
         await writeFile(`${metadata}.bak`, valid);
         await writeFile(metadata, JSON.stringify(damaged));
         const recovered = new CollectionService();
         await recovered.open(root);
         const displayedA = recovered.clips.find((clip) => clip.relativePath === "A.mp4")!;
         expect(await recovered.filesForDeletion(displayedA.id)).toEqual([await realpath(a)]);
         expect(recovered.warnings).toContain("Collection metadata was recovered from its backup.");
         io.exported = [];
         await recovered.createShareable(displayedA.id, 1);
         expect(io.exported).toEqual([await realpath(a)]);
         expect(recovered.jobs.at(-1)?.state).toBe("complete");
         await recovered.rename(displayedA.id, "Renamed A");
         expect(await readFile(join(root, "Renamed A.mp4"), "utf8")).toBe("original A");
         expect(await readFile(b, "utf8")).toBe("original B");
         expect(await recovered.filesForDeletion(displayedA.id)).toEqual([
            await realpath(join(root, "Renamed A.mp4")),
            recovered.clips.find((clip) => clip.id === displayedA.id)!.shareables[0]!.path,
         ]);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("keeps duplicate metadata untouched when no recovery copy is valid", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-duplicate-unrecoverable-"));
      try {
         await writeFile(join(root, "A.mp4"), "original A");
         await writeFile(join(root, "B.mp4"), "original B");
         const collection = new CollectionService();
         await collection.open(root);
         const metadata = join(root, ".acroclip", "collection.json");
         const damaged = JSON.parse(await readFile(metadata, "utf8")) as { clips: { id: string }[] };
         damaged.clips[1]!.id = damaged.clips[0]!.id;
         const bytes = JSON.stringify(damaged);
         await writeFile(metadata, bytes);
         await writeFile(`${metadata}.bak`, bytes);
         const recovered = new CollectionService();
         await recovered.open(root);
         expect(new Set(recovered.clips.map((clip) => clip.id)).size).toBe(2);
         expect(recovered.warnings).toContain(
            "Collection metadata is damaged. Videos remain available, but categories and shareable changes are disabled to preserve recovery information."
         );
         await expect(recovered.rename(recovered.clips[0]!.id, "Changed")).rejects.toThrow("metadata");
         await expect(recovered.createShareable(recovered.clips[0]!.id, 1)).rejects.toThrow("metadata");
         expect(await readFile(metadata, "utf8")).toBe(bytes);
         expect(await readFile(`${metadata}.bak`, "utf8")).toBe(bytes);
         expect(await readFile(join(root, "A.mp4"), "utf8")).toBe("original A");
         expect(await readFile(join(root, "B.mp4"), "utf8")).toBe("original B");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});

describe("collection ownership boundaries", () => {
   const root = resolve("isolated-collection");
   it("accepts collection files and nested folders", () => {
      expect(withinRoot(root, join(root, "game", "clip.mp4"))).toBe(true);
      expect(withinRoot(root, root)).toBe(true);
   });
   it("rejects traversal and sibling folders with matching prefixes", () => {
      expect(withinRoot(root, join(root, "..", "other", "clip.mp4"))).toBe(false);
      expect(withinRoot(root, `${root}-other/clip.mp4`)).toBe(false);
   });
});

describe("collection scan cost and fresh action checks", () => {
   it("shows completed custom saving names, hides native in-progress files, and honors verified completed metadata", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-saving-names-"));
      try {
         const completed = join(
            root,
            previewFilename(
               { ...defaultPreferences, filenamePreset: "custom", filenameTemplate: "{source}.saving.{date}" },
               "Desktop",
               new Date("2026-10-12T12:00:00Z")
            )
         );
         await writeFile(completed, "complete recording");
         await writeFile(`${completed}.saving.mkv`, "in-progress bytes");
         const collection = new CollectionService();
         await collection.open(root);
         expect(collection.clips.map((clip) => clip.path)).toEqual([await realpath(completed)]);
         const id = collection.clips[0]!.id;
         await collection.rename(id, "Completed.mkv.saving");
         expect(collection.clips).toHaveLength(1);
         expect(collection.clips[0]?.id).toBe(id);
         expect(collection.clips[0]?.path).toBe(await realpath(join(root, "Completed.mkv.saving.mkv")));
         const reopened = new CollectionService();
         await reopened.open(root);
         expect(reopened.clips).toHaveLength(1);
         expect(reopened.clips[0]?.id).toBe(id);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("registers consecutive recordings after a watcher scan took an older directory snapshot", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-registration-"));
      let release: (() => void) | undefined;
      try {
         const collection = new CollectionService();
         await collection.open(root);
         await writeFile(join(root, "existing.mp4"), "older media");
         const held = new Promise<void>((resolve) => {
            release = resolve;
         });
         let entered: (() => void) | undefined;
         const scanning = new Promise<void>((resolve) => {
            entered = resolve;
         });
         io.beforeProbe = async () => {
            io.beforeProbe = undefined;
            entered?.();
            await held;
         };
         const scan = vi.spyOn(collection, "scan");
         const watcher = collection.scan();
         await scanning;
         const first = join(root, "first.mkv");
         const second = join(root, "second.mkv");
         await writeFile(first, "first saved recording");
         await writeFile(second, "second saved recording");
         const registrations = Promise.all([
            collection.registerRecording(first, "First application"),
            collection.registerRecording(second, "Second application"),
         ]);
         await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(3));
         release?.();
         const clips = await registrations;
         await watcher;
         expect(clips.map((clip) => clip.source)).toEqual(["First application", "Second application"]);
         expect(collection.clips).toHaveLength(3);
         expect(collection.warnings).toEqual([]);
      } finally {
         release?.();
         io.beforeProbe = undefined;
         await rm(root, { recursive: true, force: true });
      }
   });
   it("keeps a warm 200-file scan free of sampled reads and metadata writes", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-scan-cost-"));
      try {
         await Promise.all(Array.from({ length: 200 }, (_, index) => writeFile(join(root, `clip-${index}.mp4`), `synthetic media ${index}`)));
         const collection = new CollectionService();
         io.identities = io.writes = 0;
         const initialStart = performance.now();
         await collection.open(root);
         const initialMs = performance.now() - initialStart;
         expect(collection.clips).toHaveLength(200);
         expect(io.identities).toBe(200);
         io.identities = io.writes = 0;
         const warmStart = performance.now();
         await collection.scan();
         const warmMs = performance.now() - warmStart;
         expect(io.identities).toBe(0);
         expect(io.writes).toBe(0);
         console.log(
            `Collection filesystem profile, 200 synthetic files with media probe mocked: initial ${initialMs.toFixed(0)}ms, warm ${warmMs.toFixed(0)}ms.`
         );
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("skips unchanged sampling and metadata writes, but rereads changed files and before deletion", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-scan-"));
      try {
         const file = join(root, "clip.mp4");
         await writeFile(file, "synthetic media fixture");
         const collection = new CollectionService();
         await collection.open(root);
         const id = collection.clips[0]!.id;
         const metadata = join(root, ".acroclip", "collection.json");
         const firstMetadataTime = (await stat(metadata, { bigint: true })).mtimeNs;
         io.identities = io.writes = 0;
         await collection.scan();
         await collection.scan();
         expect(io.identities).toBe(0);
         expect(io.writes).toBe(0);
         expect((await stat(metadata, { bigint: true })).mtimeNs).toBe(firstMetadataTime);
         expect(await collection.filesForDeletion(id)).toEqual([await realpath(file)]);
         expect(io.identities).toBe(1);
         const before = await stat(file);
         await writeFile(file, "different media content");
         await utimes(file, before.atime, before.mtime);
         io.identities = 0;
         await collection.scan();
         expect(io.identities).toBe(1);
         expect(collection.clips[0]!.id).not.toBe(id);
         expect(io.writes).toBe(1);
         // Repair a primary removed outside the app, despite unchanged in-memory metadata.
         await rm(metadata);
         await collection.scan();
         expect((await stat(metadata)).size).toBeGreaterThan(0);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});

describe("portable category appearance", () => {
   it("retains category identity, icon and memberships across edits and folder moves", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-category-appearance-")),
         moved = `${root}-moved`;
      try {
         await writeFile(join(root, "Moment.mp4"), "controlled media");
         const first = new CollectionService();
         await first.open(root);
         await first.createCategory("Games", "#77b9ef", "game");
         const id = first.categories[0]!.id,
            clipId = first.clips[0]!.id;
         await first.assignCategories(clipId, [id]);
         await first.updateCategory(id, "Highlights", "#73c6a1", "trophy");
         await rename(root, moved);
         const second = new CollectionService();
         await second.open(moved);
         expect(second.categories).toEqual([{ id, name: "Highlights", color: "#73c6a1", icon: "trophy" }]);
         expect(second.clips[0]!.categories).toEqual([id]);
         expect(second.clips[0]!.id).toBe(clipId);
      } finally {
         await rm(root, { recursive: true, force: true });
         await rm(moved, { recursive: true, force: true });
      }
   });
});

describe("collection folders", () => {
   it("lists empty hierarchy and ignores directory links outside the collection", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-folders-")),
         outside = await mkdtemp(join(os.tmpdir(), "acroclip-outside-"));
      try {
         await mkdir(join(root, "Games", "Empty"), { recursive: true });
         await mkdir(join(root, "Other", "Empty"), { recursive: true });
         await symlink(outside, join(root, "Outside"), process.platform === "win32" ? "junction" : "dir");
         const service = new CollectionService();
         await service.open(root);
         expect(service.folders).toEqual(["Games", "Games/Empty", "Other", "Other/Empty"]);
         expect(service.clips).toEqual([]);
         await rm(join(root, "Games", "Empty"), { recursive: true });
         await service.scan();
         expect(service.folders).not.toContain("Games/Empty");
      } finally {
         await rm(root, { recursive: true, force: true });
         await rm(outside, { recursive: true, force: true });
      }
   });
});

describe("saved application icons", () => {
   it("keeps the captured app identity and local icon when the entire collection moves", async () => {
      const parent = await mkdtemp(join(os.tmpdir(), "acroclip-portable-app-")),
         root = join(parent, "clips"),
         moved = join(parent, "moved");
      await mkdir(root);
      try {
         const file = join(root, "Moment.mp4");
         await writeFile(file, "isolated video");
         const app = {
            id: "a".repeat(64),
            icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
         };
         const service = new CollectionService();
         await service.open(root);
         const clip = await service.registerRecording(file, "Captured app", app);
         expect(clip.applicationId).toBe(app.id);
         expect(service.applicationIcons[app.id]).toBe(app.icon);
         await rename(root, moved);
         const reopened = new CollectionService();
         await reopened.open(moved);
         expect(reopened.clips[0]).toMatchObject({ source: "Captured app", applicationId: app.id });
         expect(reopened.applicationIcons[app.id]).toBe(app.icon);
      } finally {
         await rm(parent, { recursive: true, force: true });
      }
   });
});

describe("collection loading snapshots", () => {
   it("retains a completed snapshot while refreshing, reports failure, and clears it for a different folder", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-loading-"));
      const moved = `${root}-offline`;
      let release = () => {};
      try {
         await writeFile(join(root, "First.mp4"), "first");
         await writeFile(join(root, "Notes.txt"), "not a video");
         await mkdir(join(root, "Empty folder"));
         const collection = new CollectionService();
         let probing = false;
         io.beforeProbe = () =>
            new Promise<void>((resolve) => {
               probing = true;
               release = resolve;
            });
         const opening = collection.open(root);
         await expect.poll(() => probing).toBe(true);
         expect(collection.phase).toBe("loading");
         expect(collection.discovery).toEqual({ videos: 1, byFolder: { "": 1, "Empty folder": 0 }, complete: true });
         expect(collection.clips).toEqual([]);
         io.beforeProbe = undefined;
         release();
         await opening;
         expect(collection.phase).toBe("ready");
         await writeFile(join(root, "Second.mp4"), "second");
         probing = false;
         io.beforeProbe = () =>
            new Promise<void>((resolve) => {
               probing = true;
               release = resolve;
            });
         const refresh = collection.scan();
         expect(collection.scan()).toBe(refresh);
         await expect.poll(() => probing).toBe(true);
         expect(collection.phase).toBe("refreshing");
         expect(collection.clips.map((clip) => clip.name)).toEqual(["First"]);
         io.beforeProbe = undefined;
         release();
         await refresh;
         expect(collection.clips).toHaveLength(2);
         await rename(root, moved);
         await expect(collection.scan()).rejects.toThrow();
         expect(collection.phase).toBe("error");
         expect(collection.scanError).not.toBe("");
         expect(collection.clips).toHaveLength(2);
         await rename(moved, root);
         await collection.scan();
         expect(collection.phase).toBe("ready");
         const empty = join(root, "Empty");
         await collection.open(empty);
         expect(collection.phase).toBe("ready");
         expect(collection.clips).toEqual([]);
         expect(collection.root).toBe(await realpath(empty));
      } finally {
         io.beforeProbe = undefined;
         release();
         await rm(root, { recursive: true, force: true });
         await rm(moved, { recursive: true, force: true });
      }
   });
});

describe("collection change polling", () => {
   it("keeps unchanged polls silent and imports nested additions, in-place changes, moves and removals", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-poll-"));
      const onChange = vi.fn();
      try {
         const file = join(root, "First.mp4");
         await writeFile(file, "first");
         const collection = new CollectionService({ onChange });
         await collection.open(root);
         const first = collection.clips;
         onChange.mockClear();
         io.identities = io.writes = 0;
         const poll = collection.refresh();
         expect(collection.refresh()).toBe(poll);
         await poll;
         await collection.refresh();
         expect(collection.clips).toBe(first);
         expect(onChange).not.toHaveBeenCalled();
         expect(io.identities).toBe(0);
         expect(io.writes).toBe(0);

         await mkdir(join(root, "Nested"));
         const added = join(root, "Nested", "Second.mp4");
         await writeFile(added, "second");
         await collection.refresh();
         expect(collection.folders).toEqual(["Nested"]);
         expect(collection.clips).toHaveLength(2);
         const id = collection.clips.find((clip) => clip.path === added)!.id;
         await rename(added, join(root, "Moved.mp4"));
         await collection.refresh();
         expect(collection.clips.find((clip) => clip.name === "Second")?.id).toBe(id);
         await writeFile(file, "changed in place without changing directory entries");
         await collection.refresh();
         expect(collection.clips.find((clip) => clip.path === file)?.size).toBe(51);
         await rm(join(root, "Moved.mp4"));
         await collection.refresh();
         expect(collection.clips).toHaveLength(1);
         onChange.mockClear();
         await collection.refresh();
         expect(onChange).not.toHaveBeenCalled();
         const metadataPath = join(root, ".acroclip", "collection.json");
         await rm(metadataPath);
         await collection.refresh();
         expect((await stat(metadataPath)).size).toBeGreaterThan(0);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("detects removed registered shareables and recovers after the collection returns", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-poll-shares-"));
      const moved = `${root}-offline`;
      try {
         await writeFile(join(root, "Original.mp4"), "original");
         const collection = new CollectionService();
         await collection.open(root);
         await collection.createShareable(collection.clips[0]!.id, 1);
         const share = collection.clips[0]!.shareables[0]!;
         await rm(share.path);
         await collection.refresh();
         expect(collection.clips[0]!.shareables).toEqual([]);
         await rename(root, moved);
         await expect(collection.refresh()).rejects.toThrow();
         expect(collection.phase).toBe("error");
         expect(collection.clips).toHaveLength(1);
         await rename(moved, root);
         await collection.refresh();
         expect(collection.phase).toBe("ready");
         expect(collection.clips).toHaveLength(1);
      } finally {
         await rm(root, { recursive: true, force: true });
         await rm(moved, { recursive: true, force: true });
      }
   });
   it("does not swallow additions arriving during a scan", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-poll-race-"));
      try {
         const collection = new CollectionService();
         await collection.open(root);
         await writeFile(join(root, "First.mp4"), "first");
         io.beforeProbe = async () => {
            io.beforeProbe = undefined;
            await writeFile(join(root, "During scan.mp4"), "arrived after discovery");
         };
         await collection.refresh();
         expect(collection.clips).toHaveLength(1);
         await collection.refresh();
         expect(collection.clips).toHaveLength(2);
      } finally {
         io.beforeProbe = undefined;
         await rm(root, { recursive: true, force: true });
      }
   });
});

describe("eager indexed previews", () => {
   it("hydrates before file verification, reuses unchanged media info, and hides confirmed dead entries", async () => {
      const root = await mkdtemp(join(os.tmpdir(), "acroclip-eager-"));
      try {
         const source = join(root, "Moment.mp4");
         await writeFile(source, "moment");
         const first = new CollectionService();
         await first.open(root);
         const phases: { phase: string; unverified: boolean; count: number }[] = [];
         const warm = new CollectionService({
            onChange: () => phases.push({ phase: warm.phase, unverified: warm.clips[0]?.availability === "unverified", count: warm.clips.length }),
         });
         let probes = 0;
         io.beforeProbe = async () => {
            probes++;
         };
         await warm.open(root);
         expect(phases.some((value) => value.phase === "loading" && value.unverified && value.count === 1)).toBe(true);
         expect(probes).toBe(0);
         expect(warm.clips[0]?.availability).toBeUndefined();
         await rm(source);
         await warm.scan();
         expect(warm.clips).toEqual([]);
         expect(warm.phase).toBe("ready");
         const reopened = new CollectionService();
         const ghosts: number[] = [];
         const cleared = new CollectionService({ onChange: () => ghosts.push(cleared.clips.length) });
         await cleared.open(root);
         expect(ghosts.every((count) => count === 0)).toBe(true);
         await reopened.open(root);
         expect(reopened.clips).toEqual([]);
      } finally {
         io.beforeProbe = undefined;
         await rm(root, { recursive: true, force: true });
      }
   });
});
