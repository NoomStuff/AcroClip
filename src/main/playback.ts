import { createHash, randomUUID } from "node:crypto";
import { readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { extname, join } from "node:path";
import { ffmpegBase, probe, runMedia } from "./media";
import type { MediaInfo } from "./media";

interface PlaybackOperation {
   promise: Promise<string>;
   controller: AbortController;
   consumers: Set<symbol>;
}

export interface PlaybackOptions {
   /** Metadata the caller already read for this exact file stamp. */
   info?: MediaInfo;
   /** The renderer could not decode the original, so prepare a converted copy. */
   compatible?: boolean;
   signal?: AbortSignal;
}

// What Chromium in Electron demuxes and decodes from a plain file URL, measured
// against real files. HEVC depends on platform decoders, so the renderer reports
// a missing picture and asks again with `compatible`.
const directContainers = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".3gp"]);
const decodableVideo = new Set(["h264", "av1", "vp9", "vp8"]);
const decodableAudio = new Set(["aac", "opus", "vorbis", "mp3", "flac"]);
/** Containers ffmpeg can copy decodable audio into without encoding again. */
const copyableAudio = new Set(["aac", "mp3", "opus", "flac"]);
const preparedName = /^[a-f0-9]{64}\.mp4$/;
const temporaryName = /^[a-f0-9]{64}\.mp4\.[a-f0-9-]{36}\.mp4$/;
/** Prepared copies are disposable. Keep the most recent ones up to this size. */
export const playbackCacheBytes = 4 * 1024 ** 3;

/** Whether the renderer can play the original file and switch its audio tracks itself. */
export function playsDirectly(path: string, info: MediaInfo): boolean {
   return (
      !info.durationFromPackets &&
      directContainers.has(extname(path).toLowerCase()) &&
      (decodableVideo.has(info.videoCodec) || info.videoCodec === "hevc") &&
      info.tracks.every((entry) => decodableAudio.has(entry.codec))
   );
}

/** Owns disposable playback copies. CollectionService owns authorization and directories. */
export class PlaybackCache {
   private generation = 0;
   private pending = new Map<string, PlaybackOperation>();
   private queue: Promise<unknown> = Promise.resolve();
   private metadata = new Map<string, { stamp: string; info: MediaInfo }>();
   private pruning: Promise<void> | undefined;

   /**
    * Resolves to the file the renderer should play. Originals the renderer decodes return
    * immediately, without waiting behind a conversion of another clip.
    */
   async prepare(source: string, directory: string | (() => Promise<string>), selection?: number | number[], options: PlaybackOptions = {}): Promise<string> {
      const { signal } = options;
      const generation = this.generation;
      signal?.throwIfAborted();
      const track = selection === undefined ? undefined : [...new Set(Array.isArray(selection) ? selection : [selection])].sort((a, b) => a - b);
      if (track && (!track.length || track.some((index) => !Number.isInteger(index) || index < 0 || index > 63)))
         throw new Error("Choose at least one valid audio track.");
      const fileStat = await stat(source, { bigint: true });
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new Error("Cancelled");
      const stamp = `${fileStat.dev}:${fileStat.ino}:${fileStat.size}:${fileStat.mtimeNs}:${fileStat.ctimeNs}`;
      const info = await this.info(source, stamp, options.info, signal);
      if (generation !== this.generation) throw new Error("Cancelled");
      if (track?.some((index) => !info.tracks.some((entry) => entry.index === index))) throw new Error("That audio track is no longer available.");
      const master = track === undefined || (track.length === 1 && track[0] === info.tracks[0]?.index);
      if (master && !options.compatible && playsDirectly(source, info)) return source;
      // A converted copy keeps every audio track, so the renderer switches between them itself.
      // An explicit selection mixes several tracks into one, which Chromium can't do.
      const variant = `${track?.join(",") ?? "all"}${options.compatible ? ":compatible" : ""}`;
      const key = createHash("sha256").update(`${source}:${stamp}:${variant}`).digest("hex");
      const folder = typeof directory === "string" ? directory : await directory();
      signal?.throwIfAborted();
      const destination = join(folder, `${key}.mp4`);
      if (await this.cached(destination)) return destination;
      let operation = this.pending.get(key);
      if (!operation || operation.controller.signal.aborted) {
         const controller = new AbortController();
         const promise = this.queue
            .catch(() => undefined)
            .then(() => {
               controller.signal.throwIfAborted();
               return this.build(source, folder, destination, info, controller.signal, track, options.compatible);
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
      this.generation++;
      for (const operation of this.pending.values()) operation.controller.abort();
   }

   /**
    * Removes the least recently played copies beyond `limit`, and temporary files a crash left
    * behind. Copies the renderer still reads may stay on disk until it lets go of them.
    */
   prune(directory: string, limit = playbackCacheBytes): Promise<void> {
      this.pruning ??= (async () => {
         try {
            const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
            const files = await Promise.all(
               entries
                  .filter((entry) => entry.isFile())
                  .map(async (entry) => {
                     const path = join(directory, entry.name);
                     const info = await stat(path).catch(() => undefined);
                     return info ? { path, name: entry.name, size: info.size, used: info.mtimeMs } : undefined;
                  })
            );
            const now = Date.now();
            let total = 0,
               kept = 0;
            for (const file of files.filter((entry) => !!entry).sort((a, b) => b.used - a.used)) {
               if (preparedName.test(file.name)) {
                  total += file.size;
                  // The most recent copy stays even when it alone exceeds the limit.
                  if (total <= limit || !kept) {
                     kept++;
                     continue;
                  }
               } else if (!temporaryName.test(file.name) || now - file.used < 6 * 60 * 60 * 1000) continue;
               await rm(file.path, { force: true }).catch(() => undefined);
            }
         } finally {
            this.pruning = undefined;
         }
      })();
      return this.pruning;
   }

   private async info(source: string, stamp: string, known: MediaInfo | undefined, signal?: AbortSignal): Promise<MediaInfo> {
      const previous = this.metadata.get(source);
      const info = known ?? (previous?.stamp === stamp ? previous.info : await probe(source, { ...(signal ? { signal } : {}), belowNormal: true }));
      this.metadata.delete(source);
      this.metadata.set(source, { stamp, info });
      while (this.metadata.size > 256) this.metadata.delete(this.metadata.keys().next().value!);
      return info;
   }

   private async cached(destination: string): Promise<boolean> {
      const cached = await stat(destination).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return undefined;
         throw error;
      });
      if (!cached?.isFile() || cached.size === 0) return false;
      // The modification time orders copies for pruning.
      const now = new Date();
      await utimes(destination, now, now).catch(() => undefined);
      return true;
   }

   private async build(
      source: string,
      directory: string,
      destination: string,
      info: MediaInfo,
      signal: AbortSignal,
      track: number[] | undefined,
      compatible = false
   ): Promise<string> {
      if (await this.cached(destination)) return destination;
      signal.throwIfAborted();
      const temporary = `${destination}.${randomUUID()}.mp4`;
      const audio =
         track === undefined
            ? ["-map", "0:a?"]
            : track.length === 1
              ? ["-map", `0:${track[0]}`]
              : [
                   "-filter_complex",
                   `${track.map((index) => `[0:${index}]`).join("")}amix=inputs=${track.length}:duration=longest:normalize=1[audio]`,
                   "-map",
                   "[audio]",
                ];
      const input = [...ffmpegBase, "-y", "-threads", "2", "-i", source, "-map", "0:v:0", ...audio];
      const selectedAudio = track ? info.tracks.filter((entry) => track.includes(entry.index)) : info.tracks;
      const mixed = !!track && track.length > 1;
      const copyAudio = !mixed && selectedAudio.every((entry) => copyableAudio.has(entry.codec));
      // Titles let the renderer label tracks in a copy the same way as the original.
      const titles = track === undefined ? info.tracks.flatMap((entry, ordinal) => [`-metadata:s:a:${ordinal}`, `title=${entry.title}`]) : [];
      const output = [...titles, "-movflags", "+faststart", temporary];
      const transcode = () =>
         runMedia("ffmpeg", [...input, "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", ...output], {
            belowNormal: true,
            signal,
         });
      const remux = (audioCodec: "copy" | "aac") =>
         runMedia("ffmpeg", [...input, "-c:v", "copy", ...(info.videoCodec === "hevc" ? ["-tag:v", "hvc1"] : []), "-c:a", audioCodec, ...output], {
            belowNormal: true,
            signal,
         });
      // Cheapest first: copy both, then encode only the audio, then encode everything.
      const attempts =
         decodableVideo.has(info.videoCodec) || (!compatible && info.videoCodec === "hevc")
            ? [...(copyAudio ? [() => remux("copy")] : []), () => remux("aac"), transcode]
            : [transcode];
      try {
         for (const [index, attempt] of attempts.entries()) {
            try {
               await attempt();
               break;
            } catch (error) {
               signal.throwIfAborted();
               if (index === attempts.length - 1) throw error;
            }
         }
         signal.throwIfAborted();
         await rename(temporary, destination);
         void this.prune(directory);
         return destination;
      } finally {
         await rm(temporary, { force: true });
      }
   }
}
