import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rename, rm, stat, symlink, realpath, readdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { CollectionService, fileIdentity, withinRoot } from "../src/main/collection";
import { PlaybackCache } from "../src/main/playback";
import {
   createKeyframeStrip,
   createThumbnail,
   ffmpegBase,
   keyframeStripColumns,
   keyframeStripFrames,
   loudnessEnvelope,
   probe,
   runMedia,
} from "../src/main/media";

const workspace = await realpath(await mkdtemp(join(tmpdir(), "acroclip-media-")));
const root = join(workspace, "collection");
const external = join(workspace, "external");
await mkdir(join(root, "Existing game"), { recursive: true });
await mkdir(external);
let original = join(root, "Existing game", "moment.mp4");
try {
   const thumbnailRoot = join(workspace, "thumbnail-proof");
   await mkdir(thumbnailRoot);
   const colored = join(thumbnailRoot, "colored.mp4");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=160x90:r=10:d=5",
      "-vf",
      "drawbox=color=blue:t=fill:enable='gte(t,3)',drawbox=color=black:t=fill:enable='gte(t,4.5)'",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-g",
      "10",
      "-keyint_min",
      "10",
      "-sc_threshold",
      "0",
      colored,
   ]);
   const checkColor = async (image: string, color: "blue" | "red" | "black") => {
      const [red, green, blue] = await sharp(image).resize(1, 1).removeAlpha().toColourspace("srgb").raw().toBuffer();
      assert.ok(red !== undefined && green !== undefined && blue !== undefined);
      assert.ok(
         color === "blue" ? blue > 200 && red < 40 && green < 40 : color === "red" ? red > 200 && green < 40 && blue < 40 : red < 20 && green < 20 && blue < 20,
         `${color} pixels expected in ${image}`
      );
   };
   for (const format of ["mp4", "mkv", "ts", "streaming.mkv"]) {
      const file = format === "mp4" ? colored : join(thumbnailRoot, `colored.${format}`);
      if (format !== "mp4")
         await runMedia("ffmpeg", [
            ...ffmpegBase,
            "-y",
            "-i",
            colored,
            "-c",
            "copy",
            ...(format === "ts" ? ["-output_ts_offset", "30"] : format === "streaming.mkv" ? ["-f", "matroska", "-live", "1"] : []),
            file,
         ]);
      const thumbnail = join(thumbnailRoot, `${format}.jpg`);
      await createThumbnail(file, thumbnail, (await probe(file)).duration);
      await checkColor(thumbnail, "blue");
   }
   const finalFrame = join(thumbnailRoot, "final-frame.jpg");
   await runMedia("ffmpeg", [...ffmpegBase, "-y", "-ss", "4.8", "-i", colored, "-frames:v", "1", "-pix_fmt", "yuvj420p", finalFrame]);
   await checkColor(finalFrame, "black");
   const longGop = join(thumbnailRoot, "long-gop.mp4");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-i",
      colored,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-g",
      "1000",
      "-keyint_min",
      "1000",
      "-sc_threshold",
      "0",
      longGop,
   ]);
   const longThumbnail = join(thumbnailRoot, "long-gop.jpg");
   await createThumbnail(longGop, longThumbnail, 5);
   await checkColor(longThumbnail, "red");
   const short = join(thumbnailRoot, "short.mp4");
   await runMedia("ffmpeg", [...ffmpegBase, "-y", "-i", colored, "-t", "0.2", "-c", "copy", short]);
   const shortThumbnail = join(thumbnailRoot, "short.jpg");
   await createThumbnail(short, shortThumbnail, (await probe(short)).duration);
   await checkColor(shortThumbnail, "red");
   const fallbackThumbnail = join(thumbnailRoot, "fallback.jpg");
   const corruptTail = join(thumbnailRoot, "corrupt-tail.mp4");
   await copyFile(colored, corruptTail);
   const packets = JSON.parse(
      await runMedia("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_packets", "-show_entries", "packet=pos,size,flags", "-of", "json", colored])
   ) as { packets: Array<{ pos: string; size: string; flags: string }> };
   const lastKeyframe = packets.packets.filter((packet) => packet.flags.includes("K")).at(-1)!;
   const packetSize = Number(lastKeyframe.size),
      packetOffset = Number(lastKeyframe.pos);
   assert.ok(
      Number.isSafeInteger(packetSize) &&
         packetSize > 0 &&
         Number.isSafeInteger(packetOffset) &&
         packetOffset >= 0 &&
         packetOffset + packetSize <= (await stat(corruptTail)).size
   );
   const damagedVideo = await open(corruptTail, "r+");
   try {
      await damagedVideo.write(Buffer.alloc(packetSize), 0, packetSize, packetOffset);
   } finally {
      await damagedVideo.close();
   }
   await createThumbnail(corruptTail, fallbackThumbnail, 5);
   await checkColor(fallbackThumbnail, "red");
   const protectedIdentity = await fileIdentity(colored);
   await assert.rejects(createThumbnail(colored, colored, 5), /overwrite its source/);
   assert.equal(await fileIdentity(colored), protectedIdentity);
   const migrationRoot = join(workspace, "thumbnail-migration");
   await mkdir(join(migrationRoot, ".acroclip", "thumbnails"), { recursive: true });
   const migrationVideo = join(migrationRoot, "Moment.mp4");
   await copyFile(colored, migrationVideo);
   const migrationIdentity = await fileIdentity(migrationVideo);
   const legacyThumbnail = join(migrationRoot, ".acroclip", "thumbnails", `${migrationIdentity}.jpg`);
   await copyFile(fallbackThumbnail, legacyThumbnail);
   const migration = new CollectionService();
   await migration.open(migrationRoot);
   const migratedThumbnail = fileURLToPath(migration.clips[0]!.thumbnail);
   assert.ok(migratedThumbnail.endsWith(".last-keyframe-v1.jpg"));
   await checkColor(migratedThumbnail, "blue");
   await assert.rejects(stat(legacyThumbnail), { code: "ENOENT" });
   const generatedAt = (await stat(migratedThumbnail)).mtimeMs;
   await new CollectionService().open(migrationRoot);
   assert.equal((await stat(migratedThumbnail)).mtimeMs, generatedAt, "the migrated thumbnail is reused on reopen");
   assert.equal(await fileIdentity(migrationVideo), migrationIdentity, "thumbnail migration never modifies the video");

   // Hover strips: one tile per keyframe slot, the keyframe before each position, never the source touched.
   const migrationClip = migration.clips[0]!;
   const strip = await migration.keyframeStrip(migrationClip.id);
   assert.ok(strip, "a strip is made for an available clip");
   assert.equal(strip.frames, keyframeStripFrames(5));
   assert.equal(strip.columns, 5, "a short clip fits one row");
   const stripFile = fileURLToPath(strip.url);
   assert.ok(stripFile.includes(join(".acroclip", "thumbnails")), "strips live beside the thumbnails");
   const stripInfo = await sharp(stripFile).metadata();
   assert.equal(stripInfo.height, 240);
   const tileWidth = Math.floor(stripInfo.width! / strip.columns);
   assert.ok(Math.abs(tileWidth - 426) <= 2, `16:9 tiles, got ${tileWidth}px`);
   const tile = async (index: number) => {
      const output = join(migrationRoot, `tile-${index}.png`);
      await sharp(stripFile)
         .extract({ left: index * tileWidth + 8, top: 8, width: tileWidth - 16, height: 224 })
         .toFile(output);
      return output;
   };
   await checkColor(await tile(0), "red");
   await checkColor(await tile(2), "red");
   await checkColor(await tile(3), "blue");
   // Black starts at 4.5 s, between keyframes, so the last slot still shows the 4 s keyframe.
   await checkColor(await tile(4), "blue");
   const stripMade = (await stat(stripFile)).mtimeMs;
   assert.deepEqual(await migration.keyframeStrip(migrationClip.id), strip, "a second hover reuses the strip");
   assert.equal((await stat(stripFile)).mtimeMs, stripMade);
   assert.equal(await fileIdentity(migrationVideo), migrationIdentity, "making a strip never modifies the video");

   // Longer clips wrap into rows: 12 frames in rows of 8, red for 6 s, then blue.
   const wrapped = join(thumbnailRoot, "wrapped.mp4");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=10:d=6",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=10:d=6",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-g",
      "10",
      wrapped,
   ]);
   const wrappedStrip = join(thumbnailRoot, "wrapped-strip.jpg");
   const wrappedFrames = keyframeStripFrames(12);
   assert.equal(wrappedFrames, 12);
   assert.equal(keyframeStripColumns(wrappedFrames), 8);
   await createKeyframeStrip(wrapped, wrappedStrip, 12, wrappedFrames);
   const wrappedInfo = await sharp(wrappedStrip).metadata();
   assert.equal(wrappedInfo.height, 480, "two rows of 240 px");
   const cell = async (index: number) => {
      const output = join(thumbnailRoot, `cell-${index}.png`);
      const width = Math.floor(wrappedInfo.width! / 8);
      await sharp(wrappedStrip)
         .extract({ left: (index % 8) * width + 8, top: Math.floor(index / 8) * 240 + 8, width: width - 16, height: 224 })
         .toFile(output);
      return output;
   };
   await checkColor(await cell(5), "red");
   await checkColor(await cell(6), "blue");
   await checkColor(await cell(8), "blue");
   await checkColor(await cell(11), "blue");

   // Loudness follows the actual audio: quiet, a burst from 2 to 3 seconds, quiet again.
   const burst = join(thumbnailRoot, "burst.mp4");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=160x90:r=10:d=5",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc='0.01*sin(2*PI*200*t)+if(between(t,2,3),0.8*sin(2*PI*440*t),0)':s=48000:d=5",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      burst,
   ]);
   const levels = await loudnessEnvelope(burst, 5, 50);
   assert.ok(levels.length >= 48 && levels.length <= 51, `about one level per bucket, got ${levels.length}`);
   const loudest = levels.indexOf(Math.max(...levels));
   assert.ok(loudest >= 19 && loudest <= 30, `the burst peaks between 2 and 3 s, got bucket ${loudest}`);
   assert.ok(levels[5]! < levels[loudest]! - 0.3 && levels[40]! < levels[loudest]! - 0.3, "quiet stretches stay low");
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
   const streaming = join(workspace, "streaming.mkv");
   await runMedia("ffmpeg", [...ffmpegBase, "-y", "-i", original, "-map", "0:v:0", "-c:v", "copy", "-f", "matroska", "-live", "1", streaming]);
   const streamingInfo = await probe(streaming);
   assert.ok(Math.abs(streamingInfo.duration - 8) < 0.1, "Streaming Matroska without a declared duration remains playable");
   const streamingCache = join(workspace, "streaming-playback");
   await mkdir(streamingCache);
   const streamingPlayback = await new PlaybackCache().prepare(streaming, streamingCache);
   assert.notEqual(streamingPlayback, streaming, "Playback repairs missing container duration in a disposable copy");
   const repairedStreaming = await probe(streamingPlayback);
   assert.equal(repairedStreaming.durationFromPackets, undefined, "Playback copy declares its duration for browser seeking");
   assert.ok(Math.abs(repairedStreaming.duration - 8) < 0.1);
   const cancellationSource = join(workspace, "playback-pcm.mkv");
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-y",
      "-stream_loop",
      "9",
      "-i",
      original,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "pcm_s16le",
      cancellationSource,
   ]);
   const cancellationIdentity = await fileIdentity(cancellationSource);
   const cancellationCache = join(workspace, "cancelled-playback");
   await mkdir(cancellationCache);
   const playbackQueue = new PlaybackCache();
   const controller = new AbortController();
   let preparationFinished = false;
   const preparing = playbackQueue.prepare(cancellationSource, cancellationCache, undefined, { signal: controller.signal });
   void preparing.then(
      () => {
         preparationFinished = true;
      },
      () => {
         preparationFinished = true;
      }
   );
   const cancellation = assert.rejects(preparing, /Cancelled/);
   const deadline = Date.now() + 15000;
   while (!(await readdir(cancellationCache)).some((name) => name.includes(".mp4."))) {
      assert.ok(!preparationFinished && Date.now() < deadline, "Real playback conversion must begin before cancellation");
      await delay(2);
   }
   controller.abort();
   await cancellation;
   assert.equal(
      await playbackQueue.prepare(original, cancellationCache),
      original,
      "A directly playable clip opens without waiting for cancelled conversion cleanup"
   );
   const cleanupDeadline = Date.now() + 15000;
   while ((await readdir(cancellationCache)).length) {
      assert.ok(Date.now() < cleanupDeadline, "Cancelled playback leaves no published or partial copies");
      await delay(10);
   }
   assert.deepEqual(await fileIdentity(cancellationSource), cancellationIdentity, "Cancellation leaves the user's source unchanged");
   // Format coverage: what the player opens directly, what is remuxed, and what is converted.
   const formats = join(workspace, "formats");
   const formatCache = join(workspace, "format-playback");
   await mkdir(formats);
   await mkdir(formatCache);
   const formatPlayback = new PlaybackCache();
   const remuxed = async (name: string, args: string[]) => {
      const file = join(formats, name);
      await runMedia("ffmpeg", [...ffmpegBase, "-y", "-i", original, ...args, file]);
      return file;
   };
   for (const name of ["direct.mkv", "direct.mov", "direct.3gp"]) {
      const file = await remuxed(name, name.endsWith(".3gp") ? ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"] : ["-map", "0", "-c", "copy"]);
      assert.equal(await formatPlayback.prepare(file, formatCache), file, `${name} plays without a prepared copy`);
   }
   const compatibleCopy = await formatPlayback.prepare(original, formatCache, undefined, { compatible: true });
   assert.notEqual(compatibleCopy, original, "An original the player failed to decode gets a prepared copy");
   assert.equal((await probe(compatibleCopy)).videoCodec, "h264");
   for (const [name, args] of [
      ["pcm.mov", ["-map", "0", "-c:v", "copy", "-c:a", "pcm_s16le"]],
      ["stream.ts", ["-map", "0", "-c", "copy"]],
      ["broadcast.m2ts", ["-map", "0", "-c", "copy"]],
      ["legacy.flv", ["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"]],
      ["capture.avi", ["-map", "0", "-c:v", "mjpeg", "-q:v", "5", "-c:a", "pcm_s16le"]],
   ] as const) {
      const file = await remuxed(name, [...args]);
      const source = await probe(file);
      const prepared = await formatPlayback.prepare(file, formatCache);
      assert.notEqual(prepared, file, `${name} plays from a prepared copy`);
      const result = await probe(prepared);
      assert.equal(result.videoCodec, "h264", `${name} copy has playable video`);
      assert.deepEqual(
         result.tracks.map((track) => [track.codec, track.title]),
         source.tracks.map((track) => ["aac", track.title]),
         `${name} copy keeps every audio track and its title for in-player switching`
      );
      assert.ok(Math.abs(result.duration - source.duration) < 0.25, `${name} copy keeps the full clip`);
      await runMedia("ffmpeg", [...ffmpegBase, "-i", prepared, "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
   }
   assert.equal(
      await formatPlayback.prepare(join(formats, "stream.ts"), formatCache),
      await formatPlayback.prepare(join(formats, "stream.ts"), formatCache),
      "Prepared copies are reused"
   );
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
   const folderProofRoot = join(workspace, "folder-operations");
   await mkdir(join(folderProofRoot, "Source", "Nested"), { recursive: true });
   await copyFile(original, join(folderProofRoot, "Source", "Nested", "moment.mp4"));
   await writeFile(join(folderProofRoot, "Source", "notes.txt"), "unsupported files belong to the folder");
   const folderProof = new CollectionService();
   await folderProof.open(folderProofRoot);
   const folderClip = folderProof.clips[0]!;
   await folderProof.createCategory("Folder move");
   const folderCategory = folderProof.categories[0]!.id;
   await folderProof.assignCategories(folderClip.id, [folderCategory]);
   await folderProof.createFolder("", "Destination");
   await folderProof.renameFolder("Source", "Renamed");
   await folderProof.moveFolder("Renamed", "Destination");
   assert.equal(await folderProof.moveClip(folderClip.id, "Destination"), true);
   const folderReopened = new CollectionService();
   await folderReopened.open(folderProofRoot);
   const folderMovedClip = folderReopened.clips.find((clip) => clip.id === folderClip.id)!;
   assert.equal(await fileIdentity(folderMovedClip.path), before);
   assert.deepEqual(folderMovedClip.categories, [folderCategory]);
   assert.equal((await probe(folderMovedClip.path)).tracks.length, 2);
   await runMedia("ffmpeg", ["-v", "error", "-i", folderMovedClip.path, "-f", "null", "-"]);
   assert.equal(await readFile(join(folderProofRoot, "Destination", "Renamed", "notes.txt"), "utf8"), "unsupported files belong to the folder");
   const trashedFolder = await folderReopened.inspectFolder("Destination/Renamed");
   await folderReopened.trashFolder("Destination/Renamed", trashedFolder.fingerprint, (path) => rename(path, join(workspace, "trashed-folder")));
   assert.equal(await readFile(join(workspace, "trashed-folder", "notes.txt"), "utf8"), "unsupported files belong to the folder");
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
   const audioPackets = (path: string, stream: string) =>
      runMedia("ffprobe", [
         "-v",
         "error",
         "-select_streams",
         stream,
         "-show_packets",
         "-show_data_hash",
         "sha256",
         "-show_entries",
         "packet=data_hash",
         "-of",
         "csv=p=0",
         path,
      ]);
   assert.equal(
      await audioPackets(fileURLToPath(playback), "a:0"),
      await audioPackets(original, "a:1"),
      "compatible single-track playback preserves encoded audio packets instead of encoding them again"
   );
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
   assert.ok(recovered.warnings.some((warning) => warning.includes("restored from its backup")));
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
   await assert.rejects(damaged.createCategory("Do not overwrite recovery data"), /locked while collection info is damaged/);
   assert.equal(await readFile(movedMetadataPath, "utf8"), "broken", "unrecoverable metadata remains untouched");

   // Overlapping saves from one capture session merge losslessly.
   const mergeRoot = join(workspace, "merge-collection");
   const mergeTrash = join(workspace, "merge-trash");
   await mkdir(mergeRoot);
   await mkdir(mergeTrash);
   const encodeSession = async (output: string, frequency: number) =>
      runMedia("ffmpeg", [
         ...ffmpegBase,
         "-y",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=320x180:rate=30",
         "-f",
         "lavfi",
         "-i",
         `sine=frequency=${frequency}:sample_rate=48000`,
         "-f",
         "lavfi",
         "-i",
         `sine=frequency=${frequency * 1.5}:sample_rate=48000`,
         "-t",
         "14",
         "-map",
         "0",
         "-map",
         "1",
         "-map",
         "2",
         "-c:v",
         "libx264",
         "-preset",
         "ultrafast",
         "-bf",
         "0",
         "-g",
         "30",
         "-keyint_min",
         "30",
         "-sc_threshold",
         "0",
         "-c:a",
         "aac",
         "-metadata:s:a:0",
         "title=Master",
         "-metadata:s:a:1",
         "title=Microphone",
         output,
      ]);
   // The recorder starts each clip at a keyframe of the same encoder output: a stream copy from it.
   const saveFromSession = (source: string, from: number, length: number, output: string) =>
      runMedia("ffmpeg", [
         ...ffmpegBase,
         "-y",
         "-ss",
         String(from),
         "-i",
         source,
         "-t",
         String(length),
         "-map",
         "0",
         "-c",
         "copy",
         // The recorder names every track. MP4 stores it where a plain stream copy drops it.
         "-metadata:s:a:0",
         "title=Master",
         "-metadata:s:a:1",
         "title=Microphone",
         output,
      ]);
   const sessionVideo = join(workspace, "merge-session.mp4");
   const otherSession = join(workspace, "merge-other-session.mp4");
   await encodeSession(sessionVideo, 440);
   await encodeSession(otherSession, 550);
   const pairs = {
      merged: [join(mergeRoot, "Game older.mp4"), join(mergeRoot, "Game newer.mp4")],
      viewed: [join(mergeRoot, "Viewed older.mp4"), join(mergeRoot, "Viewed newer.mp4")],
      unrelated: [join(mergeRoot, "Unrelated older.mp4"), join(mergeRoot, "Unrelated newer.mp4")],
      stuck: [join(mergeRoot, "Stuck older.mp4"), join(mergeRoot, "Stuck newer.mp4")],
   } as const;
   for (const [name, [older, newer]] of Object.entries(pairs)) {
      await saveFromSession(sessionVideo, 0, 6, older);
      await saveFromSession(name === "unrelated" ? otherSession : sessionVideo, 3, 7, newer);
   }
   const leftover = join(mergeRoot, ".acroclip-merge-00000000-0000-4000-8000-000000000000.mp4");
   await writeFile(leftover, "interrupted merge");
   const merging = new CollectionService();
   await merging.open(mergeRoot);
   await assert.rejects(stat(leftover), { code: "ENOENT" }, "an interrupted merge's copy is cleaned up");
   const idFor = (path: string) => {
      const found = merging.clips.find((entry) => entry.path === path);
      assert.ok(found, `${path} is in the collection`);
      return found.id;
   };
   assert.ok(
      merging.clips.every((entry) => entry.watched),
      "videos already in a collection before view tracking count as watched"
   );
   const trashInto = async (path: string) => rename(path, join(mergeTrash, `${Date.now()}-${path.split(/[\\/]/).at(-1)}`));
   const [olderPath, newerPath] = pairs.merged;
   const olderId = idFor(olderPath),
      newerId = idFor(newerPath);
   const olderBytes = await readFile(olderPath);
   const mergedOutcome = await merging.mergeRecordings(olderId, newerId, trashInto);
   assert.ok(mergedOutcome.merged, `overlapping clips merge: ${mergedOutcome.merged ? "" : mergedOutcome.reason}`);
   assert.equal(mergedOutcome.previousKept, false);
   assert.ok(Math.abs(mergedOutcome.duration - 10) < 0.1, `merged clip covers both saves, got ${mergedOutcome.duration}`);
   await assert.rejects(stat(olderPath), { code: "ENOENT" }, "the older clip went to the trash");
   const trashed = await readdir(mergeTrash);
   assert.equal(trashed.length, 1);
   assert.deepEqual(await readFile(join(mergeTrash, trashed[0]!)), olderBytes, "the trash holds the older clip unchanged");
   const mergedInfo = await probe(newerPath);
   assert.deepEqual(
      mergedInfo.tracks.map((track) => track.title),
      ["Master", "Microphone"],
      "the merged clip keeps its audio track names"
   );
   await runMedia("ffmpeg", ["-v", "error", "-i", newerPath, "-f", "null", "-"]);
   const mergedClip = merging.clips.find((entry) => entry.id === newerId);
   assert.equal(mergedClip?.path, newerPath, "the merged clip keeps the newer clip's name and identity");
   assert.equal(mergedClip?.mergedFrom, 2);
   assert.ok(!merging.clips.some((entry) => entry.id === olderId), "the older clip leaves the library");

   const [viewedOlder, viewedNewer] = pairs.viewed;
   await merging.markViewed(idFor(viewedOlder));
   const viewedOutcome = await merging.mergeRecordings(idFor(viewedOlder), idFor(viewedNewer), trashInto);
   assert.equal(viewedOutcome.merged, false, "a clip someone opened is never merged away");
   assert.ok((await stat(viewedOlder)).size > 0 && (await stat(viewedNewer)).size > 0);

   const [unrelatedOlder, unrelatedNewer] = pairs.unrelated;
   const unrelatedBefore = await fileIdentity(unrelatedNewer);
   const unrelatedOutcome = await merging.mergeRecordings(idFor(unrelatedOlder), idFor(unrelatedNewer), trashInto);
   assert.equal(unrelatedOutcome.merged, false, "clips from different sessions keep both");
   assert.equal(await fileIdentity(unrelatedNewer), unrelatedBefore, "a refused merge leaves the newer clip untouched");
   assert.ok((await stat(unrelatedOlder)).size > 0);

   const [stuckOlder, stuckNewer] = pairs.stuck;
   const stuckOutcome = await merging.mergeRecordings(idFor(stuckOlder), idFor(stuckNewer), () => Promise.reject(new Error("No trash on this drive")));
   assert.ok(stuckOutcome.merged && stuckOutcome.previousKept, "an older clip that can't go to the trash stays, never deleted");
   assert.ok((await stat(stuckOlder)).size > 0);
   assert.ok(merging.clips.some((entry) => entry.path === stuckOlder));
   assert.equal((await readdir(mergeRoot)).filter((name) => name.startsWith(".acroclip-merge-")).length, 0, "no merge copies remain");

   const mergeReopened = new CollectionService();
   await mergeReopened.open(mergeRoot);
   assert.equal(mergeReopened.clips.find((entry) => entry.id === newerId)?.mergedFrom, 2, "merge details survive reopening");
   console.log(
      "Media verification passed: last-keyframe thumbnails and cache migration, keyframe hover strips, loudness envelopes, real multi-track video, full-duration size-target export, playback decode, categories, cancellation, folder conflicts, relative moves, metadata recovery, deletion boundaries, and lossless merging of overlapping saves."
   );
} finally {
   assert.ok(withinRoot(await realpath(tmpdir()), workspace), "test cleanup stays within isolated temporary workspace");
   await rm(workspace, { recursive: true, force: true });
}
