import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LoudnessCache, decodeLevels, encodeLevels } from "./loudness-cache";

const folders: string[] = [];
async function cacheFile(): Promise<string> {
   const folder = await mkdtemp(join(tmpdir(), "acroclip-loudness-"));
   folders.push(folder);
   return join(folder, "loudness-cache.json");
}
afterEach(async () => {
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("stored loudness", () => {
   it("keeps levels to within a byte's step", () => {
      const levels = [0, 0.25, 0.5, 0.999, 1, 1.4, -0.2];
      const decoded = decodeLevels(encodeLevels(levels));
      expect(decoded).toHaveLength(levels.length);
      for (const [index, level] of levels.entries()) expect(decoded[index]).toBeCloseTo(Math.min(1, Math.max(0, level)), 2);
   });
   it("survives a restart and forgets a changed file", async () => {
      const file = await cacheFile();
      const first = new LoudnessCache(file);
      await first.set(LoudnessCache.key("c:\\clips\\a.mp4", 100, 5), [0.5, 1]);
      await first.flush();
      const second = new LoudnessCache(file);
      expect(await second.get(LoudnessCache.key("c:\\clips\\a.mp4", 100, 5))).toEqual([128 / 255, 1]);
      // A trim that replaced the file in place changes its size and time.
      expect(await second.get(LoudnessCache.key("c:\\clips\\a.mp4", 90, 6))).toBeUndefined();
   });
   it("drops the least recently used entries past its limit", async () => {
      const file = await cacheFile();
      const cache = new LoudnessCache(file, 2);
      await cache.set("a", [0]);
      await cache.set("b", [0]);
      await cache.get("a");
      await cache.set("c", [0]);
      expect(await cache.get("b")).toBeUndefined();
      expect(await cache.get("a")).toEqual([0]);
      await cache.flush();
      expect(JSON.parse(await readFile(file, "utf8")).entries).toHaveLength(2);
   });
   it("forgets clips the collection no longer holds", async () => {
      const file = await cacheFile();
      const cache = new LoudnessCache(file);
      await cache.set("kept", [0.5]);
      await cache.set("gone", [0.5]);
      await cache.retain(new Set(["kept"]));
      expect(await cache.get("gone")).toBeUndefined();
      expect(await cache.get("kept")).toHaveLength(1);
   });
   it("starts empty from a damaged file", async () => {
      const file = await cacheFile();
      await import("node:fs/promises").then(({ writeFile }) => writeFile(file, "{not json"));
      expect(await new LoudnessCache(file).get("a")).toBeUndefined();
   });
});
