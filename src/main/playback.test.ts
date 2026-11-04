import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
   const one = service.prepare(join(root, "one"), cache, undefined, first.signal);
   const cancelled = expect(one).rejects.toThrow("Cancelled");
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   const two = service.prepare(join(root, "one"), cache, undefined, second.signal);
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
   const first = service.prepare(join(root, "one"), cache, undefined, controller.signal);
   const cancelled = expect(first).rejects.toThrow("Cancelled");
   await vi.waitFor(() => expect(jobs).toHaveLength(1));
   controller.abort();
   await cancelled;
   expect(jobs[0]!.signal.aborted).toBe(true);
   const secondController = new AbortController();
   const subscribed = vi.spyOn(secondController.signal, "addEventListener");
   const second = service.prepare(join(root, "two"), cache, undefined, secondController.signal);
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
   const obsolete = service.prepare(join(root, "two"), cache, undefined, controller.signal);
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
