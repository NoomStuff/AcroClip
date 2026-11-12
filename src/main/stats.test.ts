import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatsLog } from "./stats";
import { statsFileName, watchedBuckets } from "../shared/stats";
import { parseStatsLog } from "../shared/stats-log";

const folders: string[] = [];
afterEach(async () => {
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function collection() {
   const root = await mkdtemp(join(tmpdir(), "acroclip-stats-"));
   folders.push(root);
   return root;
}
function log(root: () => string, enabled = () => true, errors: string[] = []) {
   return new StatsLog({
      root,
      enabled,
      delayMs: 60_000,
      directory: async (at) => {
         const directory = join(at, ".acroclip", "stats");
         await mkdir(directory, { recursive: true });
         return directory;
      },
      onError: (message) => errors.push(message),
   });
}
const view = { type: "view" as const, clipId: "clip-1", seconds: 12, duration: 14, watched: Array<number>(watchedBuckets).fill(1), completed: true };

describe("StatsLog", () => {
   it("appends events to the month they happened in", async () => {
      const root = await collection();
      const stats = log(() => root);
      const october = new Date(2026, 9, 30, 23).getTime();
      const november = new Date(2026, 10, 1, 1).getTime();
      stats.record(view, october);
      stats.record({ type: "copy", clipId: "clip-1", file: "shareable", method: "drag" }, november);
      await stats.flush();
      const names = (await readdir(join(root, ".acroclip", "stats"))).sort();
      expect(names).toEqual([statsFileName(october), statsFileName(november)]);
      const events = await stats.read(root);
      expect(events.map((event) => [event.type, event.at])).toEqual([
         ["view", october],
         ["copy", november],
      ]);
   });

   it("keeps earlier lines and skips damaged ones", async () => {
      const root = await collection();
      const stats = log(() => root);
      const at = new Date(2026, 10, 5).getTime();
      stats.record(view, at);
      await stats.flush();
      const file = join(root, ".acroclip", "stats", statsFileName(at));
      await writeFile(file, `${await readFile(file, "utf8")}{"v":1,"at":5,"type":"view","clipId"\n{"v":99,"at":5,"type":"future"}\n`);
      stats.record({ ...view, clipId: "clip-2" }, at);
      await stats.flush();
      expect(parseStatsLog(await readFile(file, "utf8")).map((event) => event.type === "view" && event.clipId)).toEqual(["clip-1", "clip-2"]);
   });

   it("records nothing while switched off or without a collection", async () => {
      const root = await collection();
      let enabled = false;
      let open = "";
      const stats = log(
         () => open,
         () => enabled
      );
      stats.record(view);
      enabled = true;
      stats.record(view);
      open = root;
      enabled = false;
      stats.record(view);
      await stats.flush();
      expect(await stats.read(root)).toEqual([]);
   });

   it("rejects malformed events instead of writing them", async () => {
      const root = await collection();
      const errors: string[] = [];
      const stats = log(
         () => root,
         () => true,
         errors
      );
      stats.record({ ...view, watched: [1, 2, 3] });
      await stats.flush();
      expect(await stats.read(root)).toEqual([]);
      expect(errors).toHaveLength(1);
   });

   it("clears written and pending history", async () => {
      const root = await collection();
      const stats = log(() => root);
      stats.record(view);
      await stats.flush();
      stats.record(view);
      await stats.clear(root);
      await stats.flush();
      expect(await stats.read(root)).toEqual([]);
   });
});
