import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlaybackCache } from "./playback";
import { runMedia, probe } from "./media";
import type { MediaOptions } from "./media";

vi.mock("./media", () => ({ ffmpegBase: [], probe: vi.fn(), runMedia: vi.fn() }));
let root: string;
let cache: string;
let active: number;
let maximum: number;
let jobs: { signal: AbortSignal; finish: () => Promise<void> }[];
beforeEach(async () => {
   root = await mkdtemp(join(tmpdir(), "acroclip-playback-queue-"));
   cache = join(root, "cache");
   await mkdir(cache);
   for (const name of ["one", "two", "three"]) await writeFile(join(root, name), "original");
   active = maximum = 0;
   jobs = [];
   vi.mocked(probe).mockResolvedValue({ duration: 8, width: 640, height: 360, frameRate: 30, videoCodec: "mpeg4", tracks: [] });
   vi.mocked(runMedia).mockImplementation(async (_tool, args, options: MediaOptions = {}) => {
      const signal = options.signal!;
      const temporary = args.at(-1)!;
      await writeFile(temporary, "partial");
      active++;
      maximum = Math.max(maximum, active);
      return new Promise<string>((resolve, reject) =>
         jobs.push({
            signal,
            finish: async () => {
               active--;
               if (signal.aborted) reject(new Error("Cancelled"));
               else {
                  await writeFile(temporary, "prepared");
                  resolve("");
               }
            },
         })
      );
   });
});
afterEach(async () => {
   await rm(root, { recursive: true, force: true });
   vi.clearAllMocks();
});

it("serializes different preparations through process completion", async () => {
   const service = new PlaybackCache();
   const one = service.prepare(join(root, "one"), cache);
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   const two = service.prepare(join(root, "two"), cache);
   await jobs[0]!.finish();
   await one;
   await vi.waitFor(() => expect(jobs).toHaveLength(2));
   await jobs[1]!.finish();
   await two;
   expect(maximum).toBe(1);
   expect(await readdir(cache)).toHaveLength(2);
});

it("keeps shared work alive when only one consumer cancels", async () => {
   const service = new PlaybackCache();
   const first = new AbortController();
   const second = new AbortController();
   const subscribed = vi.spyOn(second.signal, "addEventListener");
   const one = service.prepare(join(root, "one"), cache, undefined, { signal: first.signal });
   const cancelled = expect(one).rejects.toThrow("Cancelled");
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   const two = service.prepare(join(root, "one"), cache, undefined, { signal: second.signal });
   await vi.waitFor(() => expect(subscribed).toHaveBeenCalled());
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   first.abort();
   await cancelled;
   expect(jobs[0]!.signal.aborted).toBe(false);
   await jobs[0]!.finish();
   await two;
   expect(jobs).toHaveLength(1);
});

it("cancels obsolete work and waits for its process cleanup before starting the next request", async () => {
   const service = new PlaybackCache();
   const controller = new AbortController();
   const first = service.prepare(join(root, "one"), cache, undefined, { signal: controller.signal });
   const cancelled = expect(first).rejects.toThrow("Cancelled");
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   controller.abort();
   await cancelled;
   expect(jobs[0]!.signal.aborted).toBe(true);
   const secondController = new AbortController();
   const subscribed = vi.spyOn(secondController.signal, "addEventListener");
   const second = service.prepare(join(root, "two"), cache, undefined, { signal: secondController.signal });
   await vi.waitFor(() => expect(subscribed).toHaveBeenCalled());
   expect(jobs).toHaveLength(1);
   await jobs[0]!.finish();
   await vi.waitFor(() => expect(jobs).toHaveLength(2));
   expect(await readdir(cache)).toHaveLength(1);
   await jobs[1]!.finish();
   await second;
   expect(maximum).toBe(1);
   expect(await readdir(cache)).toHaveLength(1);
});

it("skips cancelled queued requests and permits a fresh request for the same file", async () => {
   const service = new PlaybackCache();
   const first = service.prepare(join(root, "one"), cache);
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   const controller = new AbortController();
   const subscribed = vi.spyOn(controller.signal, "addEventListener");
   const obsolete = service.prepare(join(root, "two"), cache, undefined, { signal: controller.signal });
   const cancelled = expect(obsolete).rejects.toThrow("Cancelled");
   await vi.waitFor(() => expect(subscribed).toHaveBeenCalled());
   controller.abort();
   await cancelled;
   const replacement = service.prepare(join(root, "two"), cache);
   await jobs[0]!.finish();
   await first;
   await vi.waitFor(() => expect(jobs).toHaveLength(2));
   await jobs[1]!.finish();
   await replacement;
   expect(maximum).toBe(1);
   expect(vi.mocked(probe)).toHaveBeenCalledTimes(2);
});

it("invalidates preparation before its filesystem lookup can register a job", async () => {
   const service = new PlaybackCache();
   const preparation = service.prepare(join(root, "one"), cache);
   const cancelled = expect(preparation).rejects.toThrow("Cancelled");
   service.cancelAll();
   await cancelled;
   expect(probe).not.toHaveBeenCalled();
   expect(jobs).toHaveLength(0);
});

it("plays decodable originals directly without probing again or waiting behind a conversion", async () => {
   const service = new PlaybackCache();
   const converting = service.prepare(join(root, "one"), cache);
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   for (const name of ["clip.mkv", "clip.mov", "clip.webm"]) await writeFile(join(root, name), "original");
   const info = { duration: 8, width: 640, height: 360, frameRate: 30, videoCodec: "h264", tracks: [{ index: 1, title: "Master", codec: "aac" }] };
   for (const name of ["clip.mkv", "clip.mov", "clip.webm"]) expect(await service.prepare(join(root, name), cache, undefined, { info })).toBe(join(root, name));
   expect(probe).toHaveBeenCalledTimes(1);
   expect(jobs).toHaveLength(1);
   await jobs[0]!.finish();
   await converting;
});

it("converts what the player can't decode, keeping every audio track", async () => {
   const service = new PlaybackCache();
   const source = join(root, "clip.mkv");
   await writeFile(source, "original");
   const tracks = [
      { index: 1, title: "Master", codec: "aac" },
      { index: 2, title: "Microphone", codec: "ac3" },
   ];
   const preparing = service.prepare(source, cache, undefined, { info: { duration: 8, width: 640, height: 360, frameRate: 30, videoCodec: "h264", tracks } });
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   const args = vi.mocked(runMedia).mock.calls[0]![1];
   expect(args.join(" ")).toContain("-map 0:a? -c:v copy -c:a aac");
   expect(args).toContain("title=Microphone");
   await jobs[0]!.finish();
   expect(await preparing).not.toBe(source);
   // HEVC plays where the platform decodes it, and converts once the renderer reports it can't.
   const hevc = { duration: 8, width: 640, height: 360, frameRate: 30, videoCodec: "hevc", tracks: [] };
   expect(await service.prepare(source, cache, undefined, { info: hevc })).toBe(source);
   const converted = service.prepare(source, cache, undefined, { info: hevc, compatible: true });
   await vi.waitFor(() => expect(jobs).toHaveLength(2));
   expect(vi.mocked(runMedia).mock.calls[1]![1]).toContain("libx264");
   await jobs[1]!.finish();
   await converted;
});

it("prunes the least recently played copies and abandoned temporary files", async () => {
   const service = new PlaybackCache();
   const name = (character: string) => `${character.repeat(64)}.mp4`;
   const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
   for (const [index, character] of ["a", "b", "c"].entries()) {
      await writeFile(join(cache, name(character)), "x".repeat(10));
      await utimes(join(cache, name(character)), new Date(Date.now() - index * 1000), new Date(Date.now() - index * 1000));
   }
   const abandoned = `${name("d")}.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.mp4`;
   await writeFile(join(cache, abandoned), "partial");
   await utimes(join(cache, abandoned), old, old);
   await writeFile(join(cache, "unrelated.txt"), "keep");
   await service.prune(cache, 20);
   expect((await readdir(cache)).sort()).toEqual([name("a"), name("b"), "unrelated.txt"]);
   await service.prune(cache, 1);
   expect((await readdir(cache)).sort()).toEqual([name("a"), "unrelated.txt"]);
});
