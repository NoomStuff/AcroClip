import { createHash, randomUUID } from "node:crypto";
import { stat, rename, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { ffmpegBase, probe, runMedia } from "./media";
import type { MediaInfo } from "./media";

interface PlaybackOperation {
   promise: Promise<string>;
   controller: AbortController;
   consumers: Set<symbol>;
}

/** Owns disposable playback copies. CollectionService owns authorization and directories. */
export class PlaybackCache {
   private pending = new Map<string, PlaybackOperation>();
   private queue: Promise<unknown> = Promise.resolve();
   private metadata = new Map<string, { stamp: string; info: MediaInfo }>();

   async prepare(source: string, directory: string, selection?: number | number[], signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted();
      const track = selection === undefined ? undefined : [...new Set(Array.isArray(selection) ? selection : [selection])].sort((a, b) => a - b);
      if (track && (!track.length || track.some((index) => !Number.isInteger(index) || index < 0 || index > 63)))
         throw new Error("Choose at least one valid audio track.");
      const info = await stat(source, { bigint: true });
      signal?.throwIfAborted();
      const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      const key = createHash("sha256")
         .update(`${source}:${stamp}:${track?.join(",") ?? "master"}`)
         .digest("hex");
      let operation = this.pending.get(key);
      if (!operation || operation.controller.signal.aborted) {
         const controller = new AbortController();
         const promise = this.queue
            .catch(() => undefined)
            .then(() => {
               controller.signal.throwIfAborted();
               return this.build(source, directory, key, stamp, controller.signal, track);
            })
            .finally(() => {
               if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
            });
         operation = { promise, controller, consumers: new Set() };
         this.pending.set(key, operation);
         // Wait for process close and temporary-file cleanup before starting another job.
         this.queue = promise.catch(() => undefined);
      }
      const job = operation;
      const consumer = Symbol();
      job.consumers.add(consumer);
      return new Promise<string>((resolve, reject) => {
         let settled = false;
         const release = () => {
            signal?.removeEventListener("abort", cancel);
            job.consumers.delete(consumer);
            if (!job.consumers.size && this.pending.get(key) === job) job.controller.abort();
         };
         const cancel = () => {
            if (settled) return;
            settled = true;
            release();
            reject(new Error("Cancelled"));
         };
         signal?.addEventListener("abort", cancel, { once: true });
         job.promise.then(
            (result) => {
               if (settled) return;
               settled = true;
               release();
               resolve(result);
            },
            (error: unknown) => {
               if (settled) return;
               settled = true;
               release();
               reject(error);
            }
         );
         if (signal?.aborted) cancel();
      });
   }

   cancelAll(): void {
      for (const operation of this.pending.values()) operation.controller.abort();
   }

   private async build(source: string, directory: string, key: string, stamp: string, signal: AbortSignal, track?: number[]): Promise<string> {
      const destination = join(directory, `${key}.mp4`);
      const cached = await stat(destination).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return undefined;
         throw error;
      });
      if (cached?.isFile() && cached.size > 0) return destination;
      const previous = this.metadata.get(source);
      const info = previous?.stamp === stamp ? previous.info : await probe(source, { signal, belowNormal: true });
      this.metadata.set(source, { stamp, info });
      while (this.metadata.size > 256) this.metadata.delete(this.metadata.keys().next().value!);
      if (track?.some((index) => !info.tracks.some((entry) => entry.index === index))) throw new Error("That audio track is no longer available.");
      const compatibleVideo = ["h264", "av1", "vp9", "vp8"].includes(info.videoCodec);
      const compatibleAudio = info.tracks.every((entry) => ["aac", "opus", "vorbis", "mp3"].includes(entry.codec));
      if (
         (track === undefined || (track.length === 1 && track[0] === info.tracks[0]?.index)) &&
         !info.durationFromPackets &&
         compatibleVideo &&
         compatibleAudio &&
         [".mp4", ".webm", ".m4v"].includes(extname(source).toLowerCase())
      )
         return source;

      signal.throwIfAborted();
      const temporary = `${destination}.${randomUUID()}.mp4`;
      const audio =
         track === undefined
            ? ["-map", "0:a:0?"]
            : track.length === 1
              ? ["-map", `0:${track[0]}`]
              : [
                   "-filter_complex",
                   `${track.map((index) => `[0:${index}]`).join("")}amix=inputs=${track.length}:duration=longest:normalize=1[audio]`,
                   "-map",
                   "[audio]",
                ];
      const input = [...ffmpegBase, "-y", "-threads", "2", "-i", source, "-map", "0:v:0", ...audio];
      const selectedAudio = track ? info.tracks.filter((entry) => track.includes(entry.index)) : info.tracks.slice(0, 1);
      const copyAudio = selectedAudio.length <= 1 && selectedAudio.every((entry) => ["aac", "mp3"].includes(entry.codec));
      const output = ["-movflags", "+faststart", temporary];
      const transcode = () =>
         runMedia("ffmpeg", [...input, "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", ...output], {
            belowNormal: true,
            signal,
         });
      try {
         if (compatibleVideo) {
            try {
               await runMedia("ffmpeg", [...input, "-c:v", "copy", "-c:a", copyAudio ? "copy" : "aac", ...output], { belowNormal: true, signal });
            } catch {
               signal.throwIfAborted();
               // A playable codec can still require a container conversion.
               await transcode();
            }
         } else await transcode();
         signal.throwIfAborted();
         await rename(temporary, destination);
         return destination;
      } finally {
         await rm(temporary, { force: true });
      }
   }
}
