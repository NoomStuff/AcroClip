import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rename, rm, stat, symlink, realpath, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollectionService, fileIdentity, withinRoot } from "../src/main/collection";
import { ffmpegBase, probe, runMedia } from "../src/main/media";

const workspace = await realpath(await mkdtemp(join(tmpdir(), "acroclip-media-")));
const root = join(workspace, "collection");
const external = join(workspace, "external");
await mkdir(join(root, "Existing game"), { recursive: true });
await mkdir(external);
let original = join(root, "Existing game", "moment.mp4");
try {
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
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:sample_rate=48000",
      "-t",
      "8",
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
      "-crf",
      "18",
      "-c:a",
      "aac",
      "-metadata:s:a:0",
      "title=Master",
      "-metadata:s:a:1",
      "title=Microphone",
      original,
   ]);
   const before = await fileIdentity(original);
   const registrationRoot = join(workspace, "registration");
   await mkdir(registrationRoot);
   const publishedSources: string[] = [];
   const registering = new CollectionService({
      onChange: () => publishedSources.push(...registering.clips.map((entry) => entry.source)),
   });
   await registering.open(registrationRoot);
   const savedRecording = join(registrationRoot, "saved.mp4");
   await copyFile(original, savedRecording);
   const registered = await registering.registerRecording(savedRecording, "Recorded fixture");
   assert.equal(registered.source, "Recorded fixture");
   assert.ok(publishedSources.length > 0);
   assert.ok(
      publishedSources.every((source) => source === "Recorded fixture"),
      "registration never publishes a temporary Unknown source"
   );
   await writeFile(join(root, "not-a-video.mp4"), "invalid media");
   await copyFile(original, join(external, "external.mp4"));
   try {
      await symlink(external, join(root, "linked-outside"), process.platform === "win32" ? "junction" : "dir");
   } catch {
      console.log("Symlink creation unavailable; symlink test skipped.");
   }
   const service = new CollectionService();
   await service.open(root);
   assert.equal(service.clips.length, 1, "scan includes existing ordinary videos and ignores broken/symlinked files");
   const clip = service.clips[0];
   assert.ok(clip);
   assert.equal(clip.tracks.length, 2);
   assert.ok(clip.thumbnail);
   await service.createCategory("Best moments");
   await service.createCategory("Funny");
   await service.assignCategories(
      clip.id,
      service.categories.map((category) => category.id)
   );
   assert.equal(service.clips[0]?.categories.length, 2);
   await service.deleteCategory(service.categories[0]?.id ?? "");
   assert.equal(service.clips.length, 1, "category deletion never deletes the video");
   assert.equal(service.clips[0]?.categories.length, 1);
   await service.rename(clip.id, "A better display name");
   original = join(root, "Existing game", "A better display name.mp4");
   assert.equal(service.clips[0]?.name, "A better display name");
   assert.equal(await fileIdentity(original), before);

   const foreignFolder = join(root, "shareables");
   await mkdir(foreignFolder);
   const foreign = join(foreignFolder, "my-existing-file.mp4");
   await copyFile(original, foreign);
   await service.refresh();
   assert.equal(service.clips.length, 2, "unowned shareables folder is scanned rather than silently hidden");
   await service.createShareable(clip.id, 1);
   assert.equal(service.jobs.at(-1)?.state, "failed");
   assert.match(service.jobs.at(-1)?.message ?? "", /not owned/);
   assert.equal(await fileIdentity(foreign), before, "conflict preserves unrelated files");
   await rename(foreignFolder, join(root, "other-videos"));
   await service.refresh();
   await service.createShareable(clip.id, 1);
   assert.equal(service.jobs.at(-1)?.state, "complete", service.jobs.at(-1)?.message ?? "Export did not complete");
   const share = service.clips.find((entry) => entry.id === clip.id)?.shareables[0];
   assert.ok(share);
   assert.ok(share.relativePath.replaceAll("\\", "/").startsWith("shareables/Existing game/"));
   assert.ok((await stat(share.path)).size <= 1_000_000);
   const shareIdentity = await fileIdentity(share.path);
   const renamedShare = join(root, "shareables", "Existing game", `Renamed group-1MB-${share.id.slice(0, 8)}.mp4`);
   await copyFile(share.path, renamedShare);
   await assert.rejects(service.rename(clip.id, "Renamed group"), /already exists/);
   assert.equal(await fileIdentity(original), before, "shareable collision preserves the clip");
   assert.equal(await fileIdentity(share.path), shareIdentity, "shareable collision preserves the shareable");
   await assert.rejects(stat(join(root, "Existing game", "Renamed group.mp4")), /ENOENT/, "collision removes the prepared clip destination");
   await rm(renamedShare);
   await service.rename(clip.id, "Renamed group");
   assert.equal(await fileIdentity(renamedShare), shareIdentity, "group rename preserves real shareable bytes");
   assert.equal(service.clips.find((entry) => entry.id === clip.id)?.shareables[0]?.path, renamedShare);
   assert.deepEqual(await service.filesForDeletion(clip.id, undefined, "shareables"), [renamedShare], "bulk shareable deletion excludes the clip");
   assert.deepEqual(
      new Set(await service.filesForDeletion(clip.id)),
      new Set([join(root, "Existing game", "Renamed group.mp4"), renamedShare]),
      "clip deletion includes its shareables"
   );
   await service.rename(clip.id, "A better display name");
   assert.equal(await fileIdentity(original), before);
   assert.equal(await fileIdentity(share.path), shareIdentity);

   const info = await probe(share.path);
   assert.equal(info.tracks.length, 1, "shareable keeps only the master track");
   assert.ok(Math.abs(info.duration - clip.duration) < 0.25, "shareable retains full clip duration");
   assert.equal(await fileIdentity(original), before, "export does not modify original bytes");
   await runMedia("ffmpeg", [...ffmpegBase, "-i", share.path, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
   const previews = await Promise.all(Array.from({ length: 4 }, () => service.playback(original, clip.tracks[1]?.index)));
   const playback = previews[0]!;
   assert.ok(
      previews.every((url) => url === playback),
      "concurrent track selections share a completed playback copy"
   );
   assert.ok(playback.includes("playback"), "isolated-track preview uses a separate cached file");
   assert.equal((await readdir(join(root, ".acroclip", "playback"))).length, 1, "concurrent preparation leaves one copy and no temporary files");
   const playbackInfo = await probe(fileURLToPath(playback));
   assert.equal(playbackInfo.tracks.length, 1, "track preview contains only the requested audio stream");
   assert.ok(Math.abs(playbackInfo.duration - clip.duration) < 0.25, "track preview preserves clip duration");
   await runMedia("ffmpeg", [...ffmpegBase, "-i", fileURLToPath(playback), "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
   const previewAudio = join(workspace, "preview-audio.pcm");
   await runMedia("ffmpeg", [...ffmpegBase, "-i", fileURLToPath(playback), "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", previewAudio]);
   const samples = await readFile(previewAudio);
   let crossings = 0;
   const startSample = 12000;
   const endSample = Math.floor(samples.length / 2) - 12000;
   for (let sample = startSample; sample < endSample; sample++) {
      if (samples.readInt16LE(sample * 2) <= 0 && samples.readInt16LE((sample + 1) * 2) > 0) crossings++;
   }
   const frequency = crossings / ((endSample - startSample) / 48000);
   assert.ok(Math.abs(frequency - 880) < 3, `selected-track playback must contain the 880 Hz microphone tone, received ${frequency.toFixed(1)} Hz`);
   const selectedAudio = clip.tracks.map((track) => track.index);
   const mixed = await service.playback(original, selectedAudio);
   assert.equal(await service.playback(original, [...selectedAudio].reverse()), mixed, "track order shares the same mixed playback cache");
   await assert.rejects(service.playback(original, []), /at least one/);
   await assert.rejects(service.playback(original, [63]), /no longer available/);
   const mixedInfo = await probe(fileURLToPath(mixed));
   assert.equal(mixedInfo.tracks.length, 1, "chosen tracks mix into one synchronized playback stream");
   assert.ok(Math.abs(mixedInfo.duration - clip.duration) < 0.25, "mixed playback retains the complete clip");
   const mixedAudio = join(workspace, "mixed-audio.pcm");
   await runMedia("ffmpeg", [...ffmpegBase, "-i", fileURLToPath(mixed), "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", mixedAudio]);
   const mixedSamples = await readFile(mixedAudio);
   for (const tone of [440, 880]) {
      let sine = 0,
         cosine = 0;
      const count = 48000;
      for (let index = 0; index < count; index++) {
         const value = mixedSamples.readInt16LE((index + 12000) * 2) / 32768;
         const phase = (2 * Math.PI * tone * index) / 48000;
         sine += value * Math.sin(phase);
         cosine += value * Math.cos(phase);
      }
      const amplitude = (2 * Math.hypot(sine, cosine)) / count;
      assert.ok(amplitude > 0.04 && amplitude < 0.09, `mixed playback contains normalized ${tone} Hz audio, received amplitude ${amplitude}`);
   }
   assert.equal(await fileIdentity(original), before, "audio preview mixing leaves the clip unchanged");
   const collision = join(root, "Existing game", "Collision.mp4");
   await copyFile(original, collision);
   await assert.rejects(service.rename(clip.id, "Collision"), /already exists/);
   assert.equal(await fileIdentity(original), before);
   assert.equal(await fileIdentity(collision), before);
   await rm(collision);

   let cancelledId = "";
   const cancelling = new CollectionService({
      onJob: (job) => {
         if (job.state === "running") {
            cancelledId = job.id;
            cancelling.cancelJob(job.id);
         }
      },
   });
   await cancelling.open(root);
   await cancelling.createShareable(clip.id, 0.5);
   assert.ok(cancelledId);
   assert.equal(cancelling.jobs.at(-1)?.state, "cancelled");
   assert.equal(await fileIdentity(original), before);

   const primary = join(root, ".acroclip", "collection.json");
   await copyFile(primary, `${primary}.bak`);
   await writeFile(primary, "broken metadata");
   const recovered = new CollectionService();
   await recovered.open(root);
   assert.ok(recovered.warnings.some((warning) => warning.includes("recovered")));
   assert.equal(recovered.clips.find((entry) => entry.id === clip.id)?.shareables.length, 1);

   const moved = join(workspace, "moved-collection");
   await rename(root, moved);
   const reopened = new CollectionService();
   await reopened.open(moved);
   const movedClip = reopened.clips.find((entry) => entry.id === clip.id);
   assert.ok(movedClip);
   assert.equal(movedClip.shareables.length, 1, "relative paths preserve whole-folder moves");
   assert.equal(movedClip.categories.length, 1);
   const relocated = join(moved, "Existing game", "renamed-file.mp4");
   await rename(movedClip.path, relocated);
   await reopened.refresh();
   assert.equal(reopened.clips.find((entry) => entry.id === clip.id)?.path, relocated, "external rename retains verified identity");
   const deleteFiles = await reopened.filesForDeletion(clip.id, movedClip.shareables[0]?.id);
   assert.equal(deleteFiles.length, 1);
   assert.ok(deleteFiles[0]?.includes("shareables"));
   assert.equal(await fileIdentity(relocated), before);

   const movedMetadataPath = join(moved, ".acroclip", "collection.json");
   const metadata = JSON.parse(await readFile(movedMetadataPath, "utf8")) as { clips: { id: string; relativePath: string; absolutePath: string }[] };
   const linkToOutside = metadata.clips.find((entry) => entry.id === clip.id);
   assert.ok(linkToOutside);
   linkToOutside.relativePath = "missing.mp4";
   linkToOutside.absolutePath = join(external, "external.mp4");
   await rename(relocated, join(external, "moved-original.mp4"));
   await writeFile(movedMetadataPath, JSON.stringify(metadata));
   const outsideRecovery = new CollectionService();
   await outsideRecovery.open(moved);
   const remaining = await outsideRecovery.filesForDeletion(clip.id);
   assert.ok(
      remaining.every((path) => path.startsWith(moved)),
      "verified absolute fallback outside root never grants deletion ownership"
   );
   assert.equal(await fileIdentity(join(external, "external.mp4")), before);

   await writeFile(movedMetadataPath, "broken");
   await writeFile(`${movedMetadataPath}.bak`, "also broken");
   const damaged = new CollectionService();
   await damaged.open(moved);
   assert.ok(damaged.clips.length > 0, "damaged metadata never makes ordinary videos inaccessible");
   await assert.rejects(damaged.createCategory("Do not overwrite recovery data"), /Restore/);
   assert.equal(await readFile(movedMetadataPath, "utf8"), "broken", "unrecoverable metadata remains untouched");
   console.log(
      "Media verification passed: real multi-track video, full-duration size-target export, playback decode, categories, cancellation, folder conflicts, relative moves, metadata recovery, and deletion boundaries."
   );
} finally {
   assert.ok(withinRoot(await realpath(tmpdir()), workspace), "test cleanup stays within isolated temporary workspace");
   await rm(workspace, { recursive: true, force: true });
}
