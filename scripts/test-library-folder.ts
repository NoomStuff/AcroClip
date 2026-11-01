import assert from "node:assert/strict";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CollectionService, fileIdentity } from "../src/main/collection";
import { ffmpegBase, probe, runMedia } from "../src/main/media";

// Copy samples before opening a collection. The supplied folder is read only.
const folder = process.argv[2];
assert.ok(folder, "Pass a folder of real videos");
const supported = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".ts", ".flv"]);
const files = (await readdir(folder)).filter((file) => supported.has(extname(file).toLowerCase())).sort();
assert.ok(files.length, "The folder has no supported videos");
const sampleCount = Number(process.argv[3] ?? 48);
assert.ok(Number.isInteger(sampleCount) && sampleCount > 0 && sampleCount <= 1000, "Choose between 1 and 1000 samples");
const selected = new Set<string>();
for (const extension of supported) {
   const matches = files.filter((file) => extname(file).toLowerCase() === extension);
   for (const file of [matches[0], matches.at(-1)]) if (file) selected.add(file);
}
for (let index = 0; index < sampleCount; index++) selected.add(files[Math.floor((index * files.length) / sampleCount)]!);
const root = await mkdtemp(join(tmpdir(), "acroclip-real-library-"));
try {
   for (const file of selected) await copyFile(join(folder, file), join(root, file));
   const service = new CollectionService({ onWarning: (message) => console.error(message) });
   await service.open(root);
   assert.equal(service.clips.length, selected.size, "All copied videos must appear in the library");
   for (const clip of service.clips) {
      const before = await fileIdentity(clip.path);
      const original = await probe(clip.path);
      const playback = fileURLToPath(await service.playback(clip.path));
      await runMedia("ffmpeg", [...ffmpegBase, "-i", playback, "-t", "2", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
      const targetMB = Math.max(2, Math.ceil(original.duration * 0.02));
      await service.createShareable(clip.id, targetMB);
      assert.equal(service.jobs.at(-1)?.state, "complete", service.jobs.at(-1)?.message ?? "Export failed");
      const share = service.clips.find((entry) => entry.id === clip.id)?.shareables[0];
      assert.ok(share);
      const exported = await probe(share.path);
      assert.ok(Math.abs(original.duration - exported.duration) < 0.3, "Export duration must match the original");
      await runMedia("ffmpeg", [...ffmpegBase, "-i", share.path, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
      assert.equal(await fileIdentity(clip.path), before, "Playback and export must preserve original bytes");
      console.log(JSON.stringify({ file: clip.name, duration: original.duration, tracks: original.tracks.length, targetMB, exported: true }));
   }
   console.log(`Verified ${selected.size} copied videos sampled from ${files.length} files.`);
} finally {
   await rm(root, { recursive: true, force: true });
}
