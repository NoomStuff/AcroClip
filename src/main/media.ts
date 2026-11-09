import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import os from "node:os";
import type { AudioTrack } from "../shared/types";

function binaryPath(name: "ffmpeg" | "ffprobe"): string {
   const suffix = process.platform === "win32" ? ".exe" : "";
   const configured = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
   if (configured) return configured;
   const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
   for (const directory of [resources ? join(resources, "media") : "", join(process.cwd(), "resources", "media")]) {
      const candidate = join(directory, `${name}${suffix}`);
      if (directory && existsSync(candidate)) return candidate;
   }
   return `${name}${suffix}`;
}

export interface MediaOptions {
   signal?: AbortSignal;
   duration?: number;
   onProgress?: (fraction: number) => void;
   belowNormal?: boolean;
   timeoutMs?: number;
}
export const ffmpegBase = ["-hide_banner", "-loglevel", "error", "-nostdin"];

/** Wait for process close before releasing output files, including on cancellation. */
export function runMedia(name: "ffmpeg" | "ffprobe", args: string[], options: MediaOptions = {}): Promise<string> {
   return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
         reject(new Error("Cancelled"));
         return;
      }
      const child = spawn(binaryPath(name), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      if (options.belowNormal && child.pid) {
         try {
            os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
         } catch {
            /* Best effort. */
         }
      }
      let stdout = "",
         stderr = "",
         pending = "";
      let error: Error | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      let idleTimer: NodeJS.Timeout | undefined;
      const stop = () => {
         if (killTimer) return;
         child.kill();
         killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      };
      const arm = () => {
         if (idleTimer) clearTimeout(idleTimer);
         if (!killTimer)
            idleTimer = setTimeout(() => {
               error = new Error(`${name} stopped responding.`);
               stop();
            }, options.timeoutMs ?? 120_000);
      };
      options.signal?.addEventListener("abort", stop, { once: true });
      arm();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
         arm();
         stdout += data;
         if (stdout.length > 16 * 1024 * 1024) {
            error = new Error("Media analysis returned too much data.");
            stop();
         }
         pending += data;
         const lines = pending.split(/\r?\n/);
         pending = lines.pop() ?? "";
         for (const line of lines) {
            const match = /^out_time_us=(\d+)$/.exec(line);
            if (match && options.duration) options.onProgress?.(Math.min(0.99, Number(match[1]) / 1e6 / options.duration));
         }
      });
      child.stderr.on("data", (data: string) => {
         arm();
         stderr = (stderr + data).slice(-8000);
      });
      child.on("error", (failure: Error) => {
         error = failure.message.includes("ENOENT")
            ? new Error(`${name} is missing. Install the bundled media tools or configure its executable path.`)
            : failure;
      });
      child.on("close", (code) => {
         if (idleTimer) clearTimeout(idleTimer);
         if (killTimer) clearTimeout(killTimer);
         options.signal?.removeEventListener("abort", stop);
         if (options.signal?.aborted) reject(new Error("Cancelled"));
         else if (error) reject(error);
         else if (code === 0) resolve(stdout);
         else reject(new Error(stderr.trim() || `${name} exited with code ${code}.`));
      });
   });
}

interface ProbeStream {
   index?: number;
   codec_type?: string;
   codec_name?: string;
   width?: number;
   height?: number;
   avg_frame_rate?: string;
   tags?: { title?: string; name?: string; handler_name?: string };
}
interface ProbeResult {
   format?: { duration?: string };
   streams?: ProbeStream[];
}
export function audioTrackTitle(tags: ProbeStream["tags"], ordinal: number): string {
   // MP4 stores a track's title as its user-data "name".
   const title = tags?.title?.trim() || tags?.name?.trim();
   if (title) return title;
   const handler = tags?.handler_name?.trim();
   if (handler && !/^(soundhandler|sound media handler|audiohandler|audio media handler)$/i.test(handler)) return handler;
   return ordinal === 0 ? "Master" : `Audio ${ordinal + 1}`;
}
export interface MediaInfo {
   durationFromPackets?: boolean;
   duration: number;
   width: number;
   height: number;
   frameRate: number;
   videoCodec: string;
   tracks: AudioTrack[];
}

export async function createThumbnail(source: string, output: string, duration: number): Promise<void> {
   const inputPath = resolve(source),
      outputPath = resolve(output);
   if (process.platform === "win32" ? inputPath.toLowerCase() === outputPath.toLowerCase() : inputPath === outputPath)
      throw new Error("A thumbnail must not overwrite its source video.");
   await rm(output, { force: true });
   const length = Number.isFinite(duration) && duration > 0 ? duration : 0;
   const generate = async (keyframes: boolean) => {
      await runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            "-y",
            "-ss",
            String(keyframes ? Math.max(0, length - 1) : Math.min(length * 0.2, 2)),
            ...(keyframes ? ["-noaccurate_seek", "-skip_frame", "nokey"] : []),
            "-threads",
            "2",
            "-i",
            source,
            "-map",
            "0:v:0",
            "-vf",
            "scale=480:-2",
            "-pix_fmt",
            "yuvj420p",
            "-filter_threads",
            "1",
            "-threads",
            "1",
            // Container indexes can seek before the last keyframe. Keep the final
            // decoded keyframe, without buffering images or decoding intervening frames.
            ...(keyframes ? ["-fps_mode", "passthrough"] : ["-frames:v", "1"]),
            "-f",
            "image2",
            "-update",
            "1",
            output,
         ],
         { belowNormal: true }
      );
      if ((await stat(output)).size === 0) throw new Error("No thumbnail frame was decoded.");
   };
   try {
      await generate(length > 0);
   } catch {
      // An incomplete index or unsupported keyframe skip must not leave a clip blank.
      await rm(output, { force: true });
      await generate(false);
   }
}
export async function probe(path: string, options: Pick<MediaOptions, "signal" | "belowNormal"> = {}): Promise<MediaInfo> {
   const value: unknown = JSON.parse(await runMedia("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], options));
   if (!value || typeof value !== "object") throw new Error("The video metadata could not be read.");
   const result = value as ProbeResult;
   if (!Array.isArray(result.streams)) throw new Error("The file contains no readable media streams.");
   const video = result.streams.find((stream) => stream.codec_type === "video");
   let duration = Number(result.format?.duration);
   const durationFromPackets = !Number.isFinite(duration) || duration <= 0;
   if (video?.width && video.height && durationFromPackets) {
      // Streaming WebM files may omit Duration, or incorrectly declare zero.
      // Remux to the null output to measure timestamps without decoding frames.
      const progress = await runMedia("ffmpeg", [...ffmpegBase, "-i", path, "-map", "0:v:0", "-c", "copy", "-progress", "pipe:1", "-f", "null", "-"], {
         belowNormal: true,
         ...options,
      });
      duration = Math.max(0, ...Array.from(progress.matchAll(/^out_time_us=(\d+)$/gm), (match) => Number(match[1]) / 1e6));
   }
   if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error("The file contains no playable video.");
   const rate = video.avg_frame_rate?.split("/").map(Number);
   const frameRate = rate?.[1] ? (rate[0] ?? 30) / rate[1] : 30;
   return {
      ...(durationFromPackets ? { durationFromPackets: true } : {}),
      duration,
      width: video.width,
      height: video.height,
      frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30,
      videoCodec: video.codec_name ?? "unknown",
      tracks: result.streams
         .filter((stream) => stream.codec_type === "audio")
         .map((stream, ordinal) => ({
            index: stream.index ?? ordinal,
            title: audioTrackTitle(stream.tags, ordinal),
            codec: stream.codec_name ?? "unknown",
         })),
   };
}

/** Frames in a hover strip: about one per second of footage, from 2 up to 24. */
export function keyframeStripFrames(duration: number): number {
   return Math.max(2, Math.min(24, Math.round(Number.isFinite(duration) ? duration : 0)));
}

/**
 * One image with evenly spaced frames side by side, for scrubbing a thumbnail on hover.
 * Only keyframes are decoded; a position between them shows the keyframe before it, which is
 * the frame a seek would land on first anyway.
 */
export async function createKeyframeStrip(source: string, output: string, duration: number, frames = keyframeStripFrames(duration)): Promise<void> {
   if (!(duration > 0)) throw new Error("The clip has no duration to sample.");
   const temporary = `${output}.partial.jpg`;
   await rm(temporary, { force: true });
   try {
      await runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            "-y",
            "-skip_frame",
            "nokey",
            "-threads",
            "2",
            "-i",
            source,
            "-map",
            "0:v:0",
            "-an",
            // Each slot shows the keyframe at or before its start. Cloning the last keyframe
            // past the end fills the final slots, which would otherwise flush as black padding.
            "-vf",
            `tpad=stop_mode=clone:stop_duration=${Math.ceil(duration)},fps=${(frames / duration).toFixed(6)}:round=down,scale=-2:240:flags=bilinear,tile=${frames}x1`,
            "-frames:v",
            "1",
            "-q:v",
            "6",
            "-filter_threads",
            "1",
            "-f",
            "image2",
            temporary,
         ],
         { belowNormal: true }
      );
      if ((await stat(temporary)).size === 0) throw new Error("No keyframes were decoded.");
      await rename(temporary, output);
   } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
   }
}

/** Two-pass software encoding reserves audio/container overhead and never truncates the requested moment. */
export async function encodeShareable(
   source: string,
   output: string,
   passLog: string,
   info: MediaInfo,
   targetMB: number,
   options: MediaOptions
): Promise<void> {
   const maximum = Math.floor(targetMB * 1_000_000);
   const audioRate = info.tracks.length ? Math.min(128000, Math.max(32000, Math.floor(((maximum * 8) / info.duration) * 0.12))) : 0;
   const videoRate = Math.floor(((maximum * 8) / info.duration) * 0.94 - audioRate - 8000);
   if (videoRate < 25000) throw new Error("That size limit is too small for the complete clip. Choose a larger limit.");
   const budgetPerFrame = videoRate / Math.min(info.frameRate, 60);
   const maximumHeight = budgetPerFrame < 1000 ? 360 : budgetPerFrame < 2500 ? 480 : budgetPerFrame < 5000 ? 720 : 1080;
   const height = Math.max(2, Math.floor(Math.min(info.height, maximumHeight) / 2) * 2);
   const common = [
      ...ffmpegBase,
      "-filter_threads",
      "1",
      "-filter_complex_threads",
      "1",
      "-y",
      "-threads",
      "2",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-vf",
      `scale=-2:${height}:flags=lanczos`,
      "-r",
      String(Math.min(info.frameRate || 30, 60)),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      String(videoRate),
      "-passlogfile",
      passLog,
      "-progress",
      "pipe:1",
   ];
   await runMedia("ffmpeg", [...common, "-pass", "1", "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"], {
      ...options,
      belowNormal: true,
      duration: info.duration,
      onProgress: (fraction) => options.onProgress?.(fraction * 0.45),
   });
   const audio = audioRate ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", String(audioRate)] : ["-an"];
   await runMedia("ffmpeg", [...common, "-pass", "2", ...audio, "-movflags", "+faststart", "-f", "mp4", output], {
      ...options,
      belowNormal: true,
      duration: info.duration,
      onProgress: (fraction) => options.onProgress?.(0.45 + fraction * 0.5),
   });
}

/**
 * How loud each slice of the first audio track is, from 0 (silence, -60 dB or below) to 1 (full scale).
 * Measured at 8 kHz mono, which keeps the work small while leaving the shape of the moment intact.
 */
export async function loudnessEnvelope(path: string, duration: number, buckets = 240, options: Pick<MediaOptions, "signal"> = {}): Promise<number[]> {
   if (!(duration > 0)) return [];
   const samples = Math.max(1, Math.ceil((8000 * duration) / buckets));
   const output = await runMedia(
      "ffmpeg",
      [
         ...ffmpegBase,
         "-i",
         path,
         "-map",
         "0:a:0",
         "-vn",
         "-af",
         `aresample=8000,aformat=channel_layouts=mono,asetnsamples=n=${samples}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
         "-f",
         "null",
         "-",
      ],
      { ...options, belowNormal: true }
   );
   return Array.from(output.matchAll(/RMS_level=(-?[\d.]+|-inf)/g), (match) => {
      const level = match[1] === "-inf" ? -Infinity : Number(match[1]);
      return Number.isFinite(level) ? Math.min(1, Math.max(0, (level + 60) / 60)) : 0;
   });
}
