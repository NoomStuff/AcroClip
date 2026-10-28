import { createHash, randomUUID } from "node:crypto";
import { stat, rename, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { ffmpegBase, probe, runMedia } from "./media";
import type { MediaInfo } from "./media";

/** Owns disposable playback copies. CollectionService owns authorization and directories. */
export class PlaybackCache {
   private pending = new Map<string, Promise<string>>();
   private metadata = new Map<string, { stamp: string; info: MediaInfo }>();

   async prepare(source: string, directory: string, selection?: number | number[]): Promise<string> {
      const track = selection === undefined ? undefined : [...new Set(Array.isArray(selection) ? selection : [selection])].sort((a, b) => a - b);
      if (track && (!track.length || track.some((index) => !Number.isInteger(index) || index < 0 || index > 63)))
         throw new Error("Choose at least one valid audio track.");
      const info = await stat(source, { bigint: true });
      const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      const key = createHash("sha256")
         .update(`${source}:${stamp}:${track?.join(",") ?? "master"}`)
         .digest("hex");
      const existing = this.pending.get(key);
      if (existing) return existing;
      const operation = this.build(source, directory, key, stamp, track).finally(() => this.pending.delete(key));
      this.pending.set(key, operation);
      return operation;
   }

   private async build(source: string, directory: string, key: string, stamp: string, track?: number[]): Promise<string> {
      const destination = join(directory, `${key}.mp4`);
      const cached = await stat(destination).catch((error: NodeJS.ErrnoException) => {
         if (error.code === "ENOENT") return undefined;
         throw error;
      });
      if (cached?.isFile() && cached.size > 0) return destination;
      const previous = this.metadata.get(source);
      const info = previous?.stamp === stamp ? previous.info : await probe(source);
      this.metadata.set(source, { stamp, info });
      while (this.metadata.size > 256) this.metadata.delete(this.metadata.keys().next().value!);
      if (track?.some((index) => !info.tracks.some((entry) => entry.index === index))) throw new Error("That audio track is no longer available.");
      const compatibleVideo = ["h264", "av1", "vp9", "vp8"].includes(info.videoCodec);
      const compatibleAudio = info.tracks.every((entry) => ["aac", "opus", "vorbis", "mp3"].includes(entry.codec));
      if (
         (track === undefined || (track.length === 1 && track[0] === info.tracks[0]?.index)) &&
         compatibleVideo &&
         compatibleAudio &&
         [".mp4", ".webm", ".m4v"].includes(extname(source).toLowerCase())
      )
         return source;

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
      const output = ["-c:a", copyAudio ? "copy" : "aac", "-movflags", "+faststart", temporary];
      const transcode = () =>
         runMedia("ffmpeg", [...input, "-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-pix_fmt", "yuv420p", ...output], { belowNormal: true });
      try {
         if (compatibleVideo) {
            try {
               await runMedia("ffmpeg", [...input, "-c:v", "copy", ...output], { belowNormal: true });
            } catch {
               // A playable codec can still require a container conversion.
               await transcode();
            }
         } else await transcode();
         await rename(temporary, destination);
         return destination;
      } finally {
         await rm(temporary, { force: true });
      }
   }
}
