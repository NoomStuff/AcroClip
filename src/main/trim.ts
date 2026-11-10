import { stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { ffmpegBase, runMedia } from "./media";
import type { MediaOptions } from "./media";

/**
 * Keeps one range of a clip, like AttaCut does for each of its clips. The frames between the
 * first keyframes inside the range are copied untouched. Only the moments before the first
 * keyframe and after the last usable one are encoded again, so the cut lands on the chosen
 * frame without re-encoding the whole clip. The result is checked frame by frame at every
 * join before anything is published.
 */
const epsilon = 0.0001;
// Encoding a long stretch would turn a quick trim into a slow export during gameplay.
export const maximumEncodedSeconds = 20;

export interface TrimStream {
   index: number;
   type: string;
   codec: string;
   pixelFormat: string;
   width: number;
   height: number;
   sampleAspectRatio: string;
   colorPrimaries: string;
   colorTransfer: string;
   colorSpace: string;
   colorRange: string;
   chromaLocation: string;
   fieldOrder: string;
   frameRate: number;
   rotation: number;
   sampleRate: number;
   channels: number;
   channelLayout: string;
   timeBase: number;
   startTime: number | undefined;
   attachedPicture: boolean;
   default: boolean;
   title: string;
}
export interface TrimSource {
   path: string;
   extension: string;
   duration: number;
   // The container's first timestamp. Packet times are measured from it, like the player's clock.
   startOffset: number;
   streams: TrimStream[];
}
export interface PacketPoint {
   time: number;
   dts: number;
   key: boolean;
   duration?: number;
}
export interface TrimSpan {
   start: number;
   end: number;
   encode: boolean;
   // Where reading starts so the decoder sees the keyframe the span depends on.
   readStart: number;
}
export type TrimPlan =
   | {
        kind: "cut";
        start: number;
        end: number;
        spans: TrimSpan[];
        encodedSeconds: number;
        // Frames compared against the source after export, copied and encoded separately.
        copiedChecks: number[];
        encodedChecks: number[];
        frameDuration: number;
     }
   | { kind: "unsupported"; reason: string };

const ratio = (value: string | undefined): number => {
   const [numerator, denominator] = (value ?? "").split("/").map(Number);
   return numerator && denominator ? numerator / denominator : 0;
};
const known = (value: string | undefined) => (value && value !== "unknown" && value !== "unspecified" ? value : "");
const streamSchema = z.object({
   index: z.number().int(),
   codec_type: z.string().optional(),
   codec_name: z.string().optional(),
   pix_fmt: z.string().optional(),
   width: z.number().optional(),
   height: z.number().optional(),
   sample_aspect_ratio: z.string().optional(),
   color_primaries: z.string().optional(),
   color_transfer: z.string().optional(),
   color_space: z.string().optional(),
   color_range: z.string().optional(),
   chroma_location: z.string().optional(),
   field_order: z.string().optional(),
   avg_frame_rate: z.string().optional(),
   r_frame_rate: z.string().optional(),
   sample_rate: z.string().optional(),
   channels: z.number().optional(),
   channel_layout: z.string().optional(),
   time_base: z.string().optional(),
   start_time: z.string().optional(),
   disposition: z.record(z.string(), z.number()).optional(),
   tags: z.record(z.string(), z.string()).optional(),
   side_data_list: z.array(z.object({ rotation: z.number().optional() }).passthrough()).optional(),
});
const probeSchema = z.object({
   format: z.object({ duration: z.string().optional(), start_time: z.string().optional() }).optional(),
   streams: z.array(streamSchema),
});

export async function probeTrimSource(path: string, signal?: AbortSignal): Promise<TrimSource> {
   const output = await runMedia("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", path], signal ? { signal } : {});
   const result = probeSchema.parse(JSON.parse(output));
   const duration = Number(result.format?.duration);
   if (!Number.isFinite(duration) || duration <= 0) throw new Error("The clip's length could not be read.");
   const startOffset = Number(result.format?.start_time);
   return {
      path,
      extension: extname(path).toLowerCase(),
      duration,
      startOffset: Number.isFinite(startOffset) ? startOffset : 0,
      streams: result.streams.map((stream) => {
         const start = Number(stream.start_time);
         return {
            index: stream.index,
            type: stream.codec_type ?? "unknown",
            codec: stream.codec_name ?? "unknown",
            pixelFormat: stream.pix_fmt ?? "",
            width: stream.width ?? 0,
            height: stream.height ?? 0,
            sampleAspectRatio: stream.sample_aspect_ratio ?? "",
            colorPrimaries: known(stream.color_primaries),
            colorTransfer: known(stream.color_transfer),
            colorSpace: known(stream.color_space),
            colorRange: known(stream.color_range),
            chromaLocation: known(stream.chroma_location),
            fieldOrder: stream.field_order ?? "",
            frameRate: ratio(stream.avg_frame_rate) || ratio(stream.r_frame_rate),
            rotation: stream.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? 0,
            sampleRate: Number(stream.sample_rate) || 0,
            channels: stream.channels ?? 0,
            channelLayout: stream.channel_layout ?? "",
            timeBase: ratio(stream.time_base),
            startTime: Number.isFinite(start) ? start : undefined,
            attachedPicture: stream.disposition?.["attached_pic"] === 1,
            default: stream.disposition?.["default"] === 1,
            title: stream.tags?.["title"] ?? stream.tags?.["name"] ?? "",
         };
      }),
   };
}
export function trimVideo(source: TrimSource): TrimStream | undefined {
   return source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture);
}
const audioStreams = (source: TrimSource) => source.streams.filter((stream) => stream.type === "audio");

const packetSchema = z.object({
   packets: z.array(
      z.object({ pts_time: z.string().optional(), dts_time: z.string().optional(), duration_time: z.string().optional(), flags: z.string().optional() })
   ),
});
/** Video packet timestamps within 20 seconds of a time: enough to see the keyframes on either side of a cut. */
export async function packetsAround(source: TrimSource, time: number, signal?: AbortSignal): Promise<PacketPoint[]> {
   const video = trimVideo(source);
   if (!video) return [];
   const begin = Math.max(0, time - 20);
   const output = await runMedia(
      "ffprobe",
      [
         "-v",
         "error",
         "-fflags",
         "+genpts",
         "-select_streams",
         String(video.index),
         "-read_intervals",
         begin > 0 ? `${begin + source.startOffset}%+40` : "%+40",
         "-show_packets",
         "-show_entries",
         "packet=pts_time,dts_time,duration_time,flags",
         "-of",
         "json",
         source.path,
      ],
      signal ? { signal } : {}
   );
   return packetSchema
      .parse(JSON.parse(output))
      .packets.filter((packet) => packet.pts_time !== undefined)
      .map((packet) => ({
         time: Number(packet.pts_time) - source.startOffset,
         dts: Number(packet.dts_time) - source.startOffset,
         key: packet.flags?.includes("K") ?? false,
         ...(Number(packet.duration_time) > 0 ? { duration: Number(packet.duration_time) } : {}),
      }))
      .filter((packet) => Number.isFinite(packet.time))
      .sort((a, b) => a.time - b.time);
}

/** The frame start nearest a time. A cut at the clip's end stays at the end. */
export function nearestFrame(points: readonly PacketPoint[], time: number, duration: number): number {
   if (Math.abs(time - duration) < epsilon) return duration;
   let nearest: number | undefined;
   for (const point of points) if (nearest === undefined || Math.abs(point.time - time) < Math.abs(nearest - time)) nearest = point.time;
   if (nearest === undefined) return Math.max(0, Math.min(time, duration));
   return time <= 0 ? Math.max(0, nearest) : nearest;
}

const outputContainers = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const isMp4Container = (extension: string) => [".mp4", ".mov", ".m4v"].includes(extension);
const losslessAudio = (codec: string) => ["flac", "alac", "wavpack", "truehd", "mlp"].includes(codec) || codec.startsWith("pcm_");

/** Which parts of a range to copy and which to encode. Pure, so every rule is testable without media. */
export function planTrim(source: TrimSource, start: number, end: number, startPackets: readonly PacketPoint[], endPackets: readonly PacketPoint[]): TrimPlan {
   const unsupported = (reason: string): TrimPlan => ({ kind: "unsupported", reason });
   if (start < 0 || end > source.duration + epsilon || end - start < 0.05) return unsupported("Choose a longer part of the clip to keep.");
   if (start < epsilon && Math.abs(end - source.duration) < epsilon) return unsupported("Move a handle to choose what to keep.");
   if (!outputContainers.has(source.extension))
      return unsupported(`AcroClip can't trim ${source.extension.slice(1).toUpperCase()} files yet. Open the clip in AttaCut to trim it.`);
   const video = trimVideo(source);
   if (!video) return unsupported("This clip has no video to trim.");
   if (source.streams.some((stream) => stream.type !== "audio" && stream !== video))
      return unsupported("This clip has subtitles, cover art or data tracks that a trim would lose. Open it in AttaCut to keep them.");
   if (audioStreams(source).some((stream) => losslessAudio(stream.codec)))
      return unsupported("This clip's lossless audio can't be trimmed in AcroClip. Open it in AttaCut to trim it.");
   if (!startPackets.length || !endPackets.length) return unsupported("This clip has no readable frames near the cuts.");
   const snappedStart = nearestFrame(startPackets, start, source.duration);
   const snappedEnd = nearestFrame(endPackets, end, source.duration);
   if (snappedEnd - snappedStart < 0.001) return unsupported("Choose a longer part of the clip to keep.");
   // Copying starts at the first keyframe inside the range. Everything before it is encoded.
   const nextKey = startPackets.find((packet) => packet.key && packet.time >= snappedStart - epsilon)?.time;
   const copyStart = Math.max(snappedStart, nextKey ?? snappedEnd);
   // Copying ends before the last keyframe the range reaches, minus any frames shown before it
   // but decoded after it, which would lose their reference once the keyframe's group is cut.
   const previousKey = endPackets.filter((packet) => packet.key && packet.time <= snappedEnd + epsilon).at(-1);
   const dependent = previousKey
      ? endPackets.filter((packet) => packet.time < previousKey.time && packet.dts >= previousKey.dts).map((packet) => packet.time)
      : [];
   const safeEnd = dependent.length ? Math.min(...dependent) : previousKey?.time;
   const copyEnd = Math.min(snappedEnd, Math.abs(snappedEnd - source.duration) < epsilon ? source.duration : (safeEnd ?? snappedStart));
   const spans: Omit<TrimSpan, "readStart">[] = [];
   if ([...startPackets, ...endPackets].every((packet) => packet.key)) spans.push({ start: snappedStart, end: snappedEnd, encode: false });
   else if (copyEnd <= copyStart + epsilon) spans.push({ start: snappedStart, end: snappedEnd, encode: true });
   else {
      if (copyStart > snappedStart + epsilon) spans.push({ start: snappedStart, end: copyStart, encode: true });
      spans.push({ start: copyStart, end: copyEnd, encode: false });
      if (copyEnd < snappedEnd - epsilon) spans.push({ start: copyEnd, end: snappedEnd, encode: true });
   }
   const encodedSeconds = spans.filter((span) => span.encode).reduce((sum, span) => sum + span.end - span.start, 0);
   if (encodedSeconds > epsilon) {
      if (video.codec !== "h264")
         return unsupported(`AcroClip can only cut ${video.codec.toUpperCase()} clips at keyframes. Open this clip in AttaCut to trim it exactly.`);
      if (video.pixelFormat.startsWith("gbr") || (video.fieldOrder && !["unknown", "progressive"].includes(video.fieldOrder)))
         return unsupported("This clip's video format can't be cut exactly in AcroClip. Open it in AttaCut to trim it.");
      if (encodedSeconds > maximumEncodedSeconds) return unsupported("This clip has too few keyframes for a quick trim. Open it in AttaCut to trim it.");
   }
   const points = [...startPackets, ...endPackets].sort((a, b) => a.time - b.time);
   const inside = (span: Omit<TrimSpan, "readStart">) => [
      ...new Set(points.filter((point) => point.time >= span.start - epsilon && point.time < span.end - epsilon).map((point) => point.time)),
   ];
   let frameDuration = 0;
   for (const [index, point] of points.entries())
      frameDuration = Math.max(frameDuration, point.duration ?? 0, Math.max(0, (points[index + 1]?.time ?? point.time) - point.time));
   return {
      kind: "cut",
      start: snappedStart,
      end: snappedEnd,
      spans: spans.map((span) => ({
         ...span,
         readStart: Math.max(0, (points.filter((point) => point.key && point.time <= span.start + epsilon).at(-1)?.time ?? 0) - 1),
      })),
      encodedSeconds,
      // The first and last two frames of every copied span, and both ends of every encoded one.
      copiedChecks: [
         ...new Set(
            spans
               .filter((span) => !span.encode)
               .flatMap((span) => {
                  const frames = inside(span);
                  return [...frames.slice(0, 2), ...frames.slice(-2)];
               })
         ),
      ],
      encodedChecks: [
         ...new Set(
            spans
               .filter((span) => span.encode)
               .flatMap((span) => {
                  const frames = inside(span);
                  return frames.length ? [frames[0]!, frames.at(-1)!] : [];
               })
         ),
      ],
      frameDuration,
   };
}

function colorArguments(video: TrimStream): string[] {
   const args: string[] = [];
   for (const [flag, value] of [
      ["-color_primaries", video.colorPrimaries],
      ["-color_trc", video.colorTransfer],
      ["-colorspace", video.colorSpace],
      ["-color_range", video.colorRange],
      ["-chroma_sample_location", video.chromaLocation],
   ] as const)
      if (value) args.push(flag, flag === "-colorspace" && value === "gbr" ? "rgb" : value);
   return args;
}
/** Boundary frames at visually lossless quality, with headers repeated so the copied stream can follow. */
function encoderArguments(video: TrimStream): string[] {
   return [
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "17",
      "-x264-params",
      "open-gop=0:repeat-headers=1",
      // A trim is background work. Two threads leave the game and the recorder their share.
      "-threads",
      "2",
      "-pix_fmt",
      video.pixelFormat,
      "-fps_mode",
      "passthrough",
      "-enc_time_base",
      "1:90000",
      ...colorArguments(video),
   ];
}
const dropOutside = (start: number, end: number) => `noise=drop='lt(pts*tb,${start})+gte(pts*tb,${end})'`;
const concatList = (paths: string[], durations: number[]) =>
   `ffconcat version 1.0\n${paths.map((path, index) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\nduration ${durations[index]!}`).join("\n")}\n`;

export interface TrimOptions extends Pick<MediaOptions, "signal"> {
   onProgress?: (fraction: number) => void;
}
/** Writes the kept range to `output` and verifies it there. `work` holds temporary segments. */
export async function writeTrim(
   source: TrimSource,
   plan: Extract<TrimPlan, { kind: "cut" }>,
   output: string,
   work: string,
   options: TrimOptions = {}
): Promise<void> {
   const video = trimVideo(source)!;
   const audio = audioStreams(source);
   const duration = plan.end - plan.start;
   const segmentType = video.codec === "h264" || video.codec === "hevc" ? ".ts" : ".mkv";
   const weight = (span: TrimSpan) => (span.end - span.start) * (span.encode ? 4 : 1);
   const total = plan.spans.reduce((sum, span) => sum + weight(span), duration) * 1.1;
   let finished = 0;
   const report = (current: number) => options.onProgress?.(Math.min(0.9, (finished + current) / total));
   const segments: string[] = [];
   for (const [index, span] of plan.spans.entries()) {
      const path = join(work, `part-${index}${segmentType}`);
      const absoluteStart = span.start + source.startOffset;
      const absoluteEnd = span.end + source.startOffset;
      const args = [
         ...ffmpegBase,
         "-copyts",
         "-fflags",
         "+genpts",
         ...(span.readStart > 0 ? ["-ss", String(span.readStart)] : []),
         "-t",
         String(span.end - span.readStart + 2),
         "-noautorotate",
         "-i",
         source.path,
         "-map",
         `0:${video.index}`,
         "-an",
      ];
      // Both kinds share the same epsilon at their bounds, so a frame on a boundary lands in exactly one span.
      if (span.encode)
         args.push(
            "-vf",
            `trim=start=${absoluteStart - epsilon}:end=${absoluteEnd - epsilon},setpts=PTS-round(${absoluteStart}/TB)`,
            ...encoderArguments(video),
            "-t",
            String(span.end - span.start)
         );
      else
         args.push(
            "-c:v",
            "copy",
            "-bsf:v",
            `${dropOutside(absoluteStart - epsilon, absoluteEnd - epsilon)},setts=pts=PTS-${absoluteStart}/TB:dts=DTS-${absoluteStart}/TB`,
            "-t",
            String(absoluteEnd)
         );
      args.push("-avoid_negative_ts", segmentType === ".ts" ? "make_zero" : "disabled");
      if (segmentType === ".ts") args.push("-mpegts_flags", "+resend_headers", "-f", "mpegts");
      args.push("-progress", "pipe:1", path);
      await runMedia("ffmpeg", args, {
         ...options,
         belowNormal: true,
         duration: span.end - span.start,
         onProgress: (fraction) => report(weight(span) * fraction),
      });
      // FFmpeg succeeds even when nothing passed the trim. Name the problem before the join hides it.
      if (!((await stat(path).catch(() => null))?.size ?? 0)) throw new Error("No video was produced at a cut. Try moving the handle slightly.");
      finished += weight(span);
      segments.push(path);
   }
   options.signal?.throwIfAborted();
   const list = join(work, "parts.ffconcat");
   await writeFile(
      list,
      concatList(
         segments,
         plan.spans.map((span) => span.end - span.start)
      )
   );
   // Audio is copied from the source, shifted so the kept range starts at zero.
   const audioPreroll = plan.spans[0]?.readStart ?? 0;
   const mp4 = isMp4Container(source.extension);
   const args = [
      ...ffmpegBase,
      "-f",
      "concat",
      "-safe",
      "0",
      ...(video.rotation ? ["-display_rotation:v:0", String(video.rotation)] : []),
      "-i",
      list,
      ...(audioPreroll > 0 ? ["-ss", String(audioPreroll)] : []),
      "-itsoffset",
      String(-(plan.start - audioPreroll)),
      "-i",
      source.path,
      "-map",
      "0:v:0",
      ...audio.flatMap((stream) => ["-map", `1:${stream.index}`]),
      "-map_metadata",
      "1",
      "-map_metadata:s:v:0",
      `1:s:${video.index}`,
      // MP4 reads a track's name as "name" but writes it from "title", so names need restating.
      ...audio.flatMap((stream, ordinal) => (stream.title ? [`-metadata:s:a:${ordinal}`, `title=${stream.title}`] : [])),
      "-disposition:v:0",
      video.default ? "default" : "0",
      "-c",
      "copy",
      "-t",
      String(duration),
      ...(mp4
         ? ["-movflags", "+faststart", ...(video.codec === "hevc" ? ["-tag:v", "hvc1"] : [])]
         : ["-bsf:a", dropOutside(0, duration), "-avoid_negative_ts", "disabled"]),
      ...colorArguments(video),
      ...aspectArguments(video),
      "-progress",
      "pipe:1",
      output,
   ];
   await runMedia("ffmpeg", args, { ...options, belowNormal: true, duration, onProgress: (fraction) => report(duration * fraction) });
   options.signal?.throwIfAborted();
   options.onProgress?.(0.92);
   const result = await verifyStructure(source, output, plan, options.signal);
   await verifyFrames(source, result, plan, options.signal);
   options.onProgress?.(0.98);
}
/** Transport segments lose the pixel proportions. Restore them in the headers without encoding. */
function aspectArguments(video: TrimStream): string[] {
   const match = /^(\d+):(\d+)$/.exec(video.sampleAspectRatio);
   if (!match || !["h264", "hevc"].includes(video.codec) || match[1] === "0" || (match[1] === "1" && match[2] === "1")) return [];
   return ["-bsf:v:0", `${video.codec}_metadata=sample_aspect_ratio=${match[1]}/${match[2]}`];
}

const audioPacketDuration = (stream: TrimStream) =>
   (stream.codec === "aac" ? 1024 : stream.codec === "mp3" ? 1152 : ["ac3", "eac3"].includes(stream.codec) ? 1536 : stream.codec === "opus" ? 960 : 2048) /
   (stream.sampleRate || 48000);

/** The trimmed file has every track of the original, unchanged in format, and the chosen length. */
async function verifyStructure(source: TrimSource, output: string, plan: Extract<TrimPlan, { kind: "cut" }>, signal?: AbortSignal): Promise<TrimSource> {
   const fail = (what: string): never => {
      throw new Error(`The trimmed clip ${what}. The original is safe.`);
   };
   const result = await probeTrimSource(output, signal);
   const before = [trimVideo(source)!, ...audioStreams(source)];
   const after = [trimVideo(result), ...audioStreams(result)];
   if (after.some((stream) => !stream) || result.streams.length !== before.length) fail("didn't keep every track");
   for (const [index, original] of before.entries()) {
      const copy = after[index]!;
      if (original.codec !== copy.codec) fail("changed format");
      if (original.type === "video") {
         if (
            original.width !== copy.width ||
            original.height !== copy.height ||
            original.pixelFormat !== copy.pixelFormat ||
            original.rotation !== copy.rotation
         )
            fail("changed the video format");
         for (const key of ["colorPrimaries", "colorTransfer", "colorSpace", "colorRange"] as const)
            if (original[key] && original[key] !== copy[key]) fail("changed the video colors");
      } else {
         if (original.sampleRate !== copy.sampleRate || original.channels !== copy.channels) fail("changed the audio format");
         if (original.title && original.title !== copy.title) fail("lost an audio track name");
         if (original.startTime !== undefined && copy.startTime !== undefined) {
            const expected = Math.max(0, original.startTime - source.startOffset - plan.start);
            const actual = Math.max(0, copy.startTime - result.startOffset);
            if (
               expected < plan.end - plan.start &&
               Math.abs(expected - actual) > Math.max(audioPacketDuration(original), original.timeBase, copy.timeBase) * 2 + 0.0001
            )
               fail("moved the audio out of sync");
         }
      }
   }
   const video = trimVideo(source)!;
   const packet = Math.max(0, ...audioStreams(source).map(audioPacketDuration));
   const tolerance = Math.max((plan.frameDuration || (video.frameRate ? 1 / video.frameRate : 0)) * 2, packet * 2) + 0.002;
   if (Math.abs(result.duration - (plan.end - plan.start)) > tolerance) fail("doesn't have the chosen length");
   return result;
}

/**
 * Copied frames must decode exactly as they do in the original, and encoded frames must look
 * like the frames they replace. Nearby checks share one decode, so a cut never scans the clip.
 */
async function verifyFrames(source: TrimSource, output: TrimSource, plan: Extract<TrimPlan, { kind: "cut" }>, signal?: AbortSignal): Promise<void> {
   const checks = [
      ...plan.copiedChecks.map((time) => ({ time, encoded: false })),
      ...plan.encodedChecks.filter((time) => !plan.copiedChecks.includes(time)).map((time) => ({ time, encoded: true })),
   ].sort((a, b) => a.time - b.time);
   let group: typeof checks = [];
   for (const check of checks) {
      if (group.length && (group.length >= 8 || check.time - group[0]!.time > 10)) {
         await verifyFrameGroup(source, output, plan.start, group, signal);
         group = [];
      }
      group.push(check);
   }
   if (group.length) await verifyFrameGroup(source, output, plan.start, group, signal);
}
async function verifyFrameGroup(source: TrimSource, output: TrimSource, start: number, checks: { time: number; encoded: boolean }[], signal?: AbortSignal) {
   const failure = (encoded: boolean) =>
      new Error(
         encoded ? "The trimmed clip didn't match the original at a cut. The original is safe." : "A frame changed while trimming. The original is safe."
      );
   const args = ["-v", "error", "-copyts", "-filter_complex_threads", "1"];
   const input = (path: string, time: number) => {
      const seek = Math.max(0, time - 5);
      args.push(...(seek > 0 ? ["-ss", String(seek)] : []), "-noautorotate", "-reinit_filter", "0", "-i", path);
   };
   input(source.path, checks[0]!.time + source.startOffset);
   input(output.path, checks[0]!.time - start + output.startOffset);
   // Each branch decodes in its native format, then keeps one frame at the checked time.
   const graph = [
      `[0:V:0]format=pix_fmts=${trimVideo(source)!.pixelFormat},split=${checks.length}${checks.map((_, index) => `[s${index}]`).join("")}`,
      `[1:V:0]format=pix_fmts=${trimVideo(output)!.pixelFormat},split=${checks.length}${checks.map((_, index) => `[o${index}]`).join("")}`,
   ];
   const maps: string[] = [];
   const pairs: { source: number; output: number }[] = [];
   const encoded: number[] = [];
   let streams = 0;
   const map = (label: string) => {
      maps.push("-map", `[${label}]`);
      return streams++;
   };
   const frame = (label: string, time: number, target: string) =>
      graph.push(`[${label}]trim=start=${Math.max(0, time - 0.0011)},trim=end_frame=1,setpts=PTS-STARTPTS[${target}]`);
   for (const [index, check] of checks.entries()) {
      frame(`s${index}`, check.time + source.startOffset, `a${index}`);
      frame(`o${index}`, check.time - start + output.startOffset, `b${index}`);
      if (check.encoded) {
         // Only a frame at least this similar to the original passes, so a bad encode leaves its stream empty.
         graph.push(`[a${index}][b${index}]ssim,metadata=mode=select:key=lavfi.ssim.All:value=0.9:function=expr:expr='gte(VALUE1,VALUE2)'[q${index}]`);
         encoded.push(map(`q${index}`));
      } else pairs.push({ source: map(`a${index}`), output: map(`b${index}`) });
   }
   // PNG is the release build's lossless image encoder, so equal frames hash equally.
   const result = await runMedia(
      "ffmpeg",
      [...args, "-filter_complex", graph.join(";"), ...maps, "-an", "-fps_mode", "passthrough", "-c:v", "png", "-pix_fmt", "rgb48be", "-f", "framemd5", "-"],
      { belowNormal: true, ...(signal ? { signal } : {}) }
   ).catch((error: unknown) => {
      if (error instanceof Error && /Could not open encoder before EOF|received no packets|Nothing was written/.test(error.message))
         throw failure(encoded.length > 0);
      throw error;
   });
   const hashes = new Map<number, string>();
   for (const line of result.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const fields = line.split(",").map((field) => field.trim());
      const index = Number(fields[0]);
      if (fields.length !== 6 || !Number.isInteger(index) || index < 0 || index >= streams || !/^[a-f0-9]{32}$/i.test(fields[5]!) || hashes.has(index))
         throw failure(false);
      hashes.set(index, fields[5]!);
   }
   for (const pair of pairs) if (!hashes.has(pair.source) || hashes.get(pair.source) !== hashes.get(pair.output)) throw failure(false);
   if (encoded.some((index) => !hashes.has(index))) throw failure(true);
}
