import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionService } from "../src/main/collection";
import { PlaybackCache } from "../src/main/playback";
import { ffmpegBase, probe, runMedia } from "../src/main/media";
import { StateChanges } from "../src/main/state-changes";
import { defaultPreferences, stoppedRecorder } from "../src/shared/defaults";
import type { AppState } from "../src/shared/types";
import { groupFolders, summarizeClips } from "../src/renderer/src/library-index";

// Real files and media, always in a disposable collection. Run before and after
// a change on the same machine. Medians avoid a single noisy filesystem sample.
const root = await mkdtemp(join(tmpdir(), "acroclip-performance-"));
const results: Record<string, number> = {};
async function measure(name: string, action: () => Promise<void>, count = 7) {
   const times: number[] = [];
   for (let index = 0; index < count; index++) {
      const start = performance.now();
      await action();
      times.push(performance.now() - start);
   }
   results[name] = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
}
try {
   const source = join(root, "source.mkv");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      source,
   ]);
   const collectionRoot = join(root, "collection");
   await mkdir(collectionRoot);
   for (let index = 0; index < 200; index++) await copyFile(source, join(collectionRoot, `clip-${index}.mkv`));
   const collection = new CollectionService({ scanConcurrency: () => 3 });
   await collection.open(collectionRoot);
   assert.equal(collection.clips.length, 200);
   await measure("unchanged collection refresh ms", async () => {
      await collection.refresh();
   });
   await measure("warm collection scan ms", async () => {
      await collection.scan();
   });
   // An app restart: metadata and thumbnails exist, nothing is cached in memory.
   await measure("collection reopen ms", async () => {
      const reopened = new CollectionService({ scanConcurrency: () => 3 });
      await reopened.open(collectionRoot);
      assert.equal(reopened.clips.length, 200);
   });
   await collection.createCategory("Benchmark");
   const tag = collection.categories[0]!.id;
   const tagged = collection.clips[0]!.id;
   await measure("tag toggle ms", async () => {
      await collection.toggleCategory(tagged, tag);
   });
   await measure(
      "cold playback preparation ms",
      async () => {
         const cache = await mkdtemp(join(root, "playback-"));
         const result = await new PlaybackCache().prepare(source, cache);
         const info = await probe(result);
         assert.ok(Math.abs(info.duration - 30) < 0.15);
         assert.equal(info.tracks.length, 1);
         assert.equal(info.videoCodec, "h264");
      },
      5
   );
   // Opening clips: every iteration opens a clip this session hasn't played yet.
   const multiTrack = join(root, "multi-track.mkv");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=60",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "30",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:a",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      multiTrack,
   ]);
   const openRoot = join(root, "opening");
   await mkdir(openRoot);
   for (let index = 0; index < 8; index++) {
      await copyFile(multiTrack, join(openRoot, `matroska-${index}.mkv`));
      await runMedia("ffmpeg", [...ffmpegBase, "-y", "-i", multiTrack, "-map", "0", "-c", "copy", join(openRoot, `mp4-${index}.mp4`)]);
      await copyFile(multiTrack, join(openRoot, `tracks-${index}.mkv`));
   }
   const opening = new CollectionService({ scanConcurrency: () => 3 });
   await opening.open(openRoot);
   const unopened = (prefix: string) => {
      const clips = opening.clips.filter((clip) => clip.name.startsWith(prefix));
      return () => clips.pop()!;
   };
   for (const [name, prefix] of [
      ["first Matroska clip open ms", "matroska-"],
      ["first MP4 clip open ms", "mp4-"],
   ] as const) {
      const next = unopened(prefix);
      await measure(name, async () => {
         const clip = next();
         assert.ok(await opening.playback(clip.path));
      });
   }
   // The work a second audio track costs the main process before it plays.
   const nextTracks = unopened("tracks-");
   await measure("first audio track change ms", async () => {
      const clip = nextTracks();
      await opening.playback(clip.path);
   });
   const playbackBytes = await readdir(join(openRoot, ".acroclip", "playback"))
      .then((names) => Promise.all(names.map(async (name) => (await stat(join(openRoot, ".acroclip", "playback", name))).size)))
      .catch(() => []);
   results["playback copy MB after opening clips"] = playbackBytes.reduce((sum, size) => sum + size, 0) / 1e6;
   const state: AppState = {
      windowVisible: true,
      preferences: defaultPreferences,
      clips: collection.clips,
      collectionStatus: { root: collectionRoot, phase: "ready" },
      folders: collection.folders,
      applicationIcons: {},
      categories: [],
      jobs: [],
      recorder: { ...stoppedRecorder },
      pendingPreferences: {},
      update: { state: "idle", version: "", progress: 0, message: "" },
      version: "benchmark",
      platform: process.platform,
   };
   const changes = new StateChanges();
   changes.event(state);
   let fullBytes = 0,
      patchBytes = 0;
   await measure("100 full state serializations ms", async () => {
      fullBytes = 0;
      for (let index = 0; index < 100; index++) {
         state.recorder.availableSeconds = index;
         fullBytes += JSON.stringify({ type: "state", state }).length;
      }
   });
   await measure("100 incremental state serializations ms", async () => {
      patchBytes = 0;
      for (let index = 0; index < 100; index++) {
         state.recorder.availableSeconds = index;
         const event = changes.event(state);
         if (event) patchBytes += JSON.stringify(event).length;
      }
   });
   console.log("Status payload bytes", { fullBytes, patchBytes, reduction: fullBytes / patchBytes });
   const clips = Array.from({ length: 10000 }, (_, index) => ({
      ...collection.clips[index % collection.clips.length]!,
      categories: [`category-${index % 100}`, `category-${(index + 1) % 100}`],
   }));
   const categoryIds = Array.from({ length: 100 }, (_, index) => `category-${index}`);
   await measure("category counts ms", async () => {
      const summary = summarizeClips(clips);
      assert.equal(
         categoryIds.reduce((sum, id) => sum + (summary.categories.get(id) ?? 0), 0),
         20000
      );
   });
   const folders = Array.from({ length: 5000 }, (_, index) => `Games/folder-${index}`);
   await measure("folder grouping ms", async () => {
      assert.equal(groupFolders(folders).get("Games")?.length, folders.length);
   });
   const output = process.argv[2];
   if (output) {
      await mkdir(join(process.cwd(), ".cache"), { recursive: true });
      await writeFile(output, JSON.stringify(results, null, 2));
   }
   console.log(JSON.stringify(results, null, 2));
   const baseline = process.argv[3];
   if (baseline) {
      const before = JSON.parse(await readFile(baseline, "utf8")) as Record<string, number>;
      console.log(
         Object.fromEntries(
            Object.entries(results)
               .filter(([name]) => before[name] !== undefined)
               .map(([name, value]) => [name, `${(before[name]! / value).toFixed(2)}x`])
         )
      );
   }
} finally {
   await rm(root, { recursive: true, force: true });
}
