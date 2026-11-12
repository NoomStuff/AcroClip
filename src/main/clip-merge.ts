import { rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { ffmpegBase, probe, runMedia } from "./media";
import type { MediaInfo, MediaOptions } from "./media";

/**
 * Overlapping clips from one capture session are stream copies of the same
 * encoder output, so their shared footage is the same packets byte for byte.
 * A merge keeps the older clip up to the newer clip's first packet in each
 * stream and the whole newer clip after it. Nothing is decoded or encoded.
 */
interface ListedPacket {
   dts: number;
   duration: number;
   size: number;
   hash: string;
}
interface ListedStream {
   index: number;
   kind: string;
   timeBase: number;
   // Codec parameters, extradata and time base, as one comparable line.
   description: string;
   packets: ListedPacket[];
}
export interface PacketListing {
   streams: ListedStream[];
}
interface ExpectedPacket {
   time: number;
   size: number;
   hash: string;
}
export type MergePlan =
   | { kind: "contained" }
   | {
        kind: "join";
        // Older-clip time of the newer clip's timestamp zero.
        offset: number;
        // Packets kept from the older clip, per stream.
        cuts: number[];
        olderCounts: number[];
        expected: ExpectedPacket[][];
        duration: number;
     }
   | { kind: "refuse"; reason: string };

export function parsePacketListing(text: string): PacketListing {
   const headers = new Map<number, string[]>();
   const timeBases = new Map<number, number>();
   const kinds = new Map<number, string>();
   const packets = new Map<number, ListedPacket[]>();
   for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("#")) {
         const header = /^#(extradata|tb|media_type|codec_id|dimensions|sar|sample_rate|channel_layout_name) (\d+)[:,]\s*(.*)$/.exec(line);
         if (!header) continue;
         const index = Number(header[2]);
         const value = header[3]!.replace(/\s+/g, " ").trim();
         headers.set(index, [...(headers.get(index) ?? []), `${header[1]}=${value}`]);
         if (header[1] === "media_type") kinds.set(index, value);
         if (header[1] === "tb") {
            const [num, den] = value.split("/").map(Number);
            if (!num || !den) throw new Error("The clip's packet listing has an unreadable time base.");
            timeBases.set(index, num / den);
         }
         continue;
      }
      // Side data columns may follow the hash. Only the packet itself is compared.
      const fields = line.split(",").map((field) => field.trim());
      const [index, dts, , duration, size, hash] = fields;
      if (hash === undefined || !/^[\da-f]{32}$/.test(hash)) throw new Error("The clip's packet listing is unreadable.");
      const stream = Number(index);
      const list = packets.get(stream) ?? [];
      list.push({ dts: Number(dts), duration: Number(duration), size: Number(size), hash });
      packets.set(stream, list);
   }
   const indexes = [...new Set([...timeBases.keys(), ...packets.keys()])].sort((a, b) => a - b);
   return {
      streams: indexes.map((index) => {
         const timeBase = timeBases.get(index);
         if (!timeBase) throw new Error("The clip's packet listing is missing a time base.");
         return {
            index,
            kind: kinds.get(index) ?? "unknown",
            timeBase,
            description: (headers.get(index) ?? []).join(" "),
            packets: packets.get(index) ?? [],
         };
      }),
   };
}

const seconds = (stream: ListedStream, packet: ListedPacket) => packet.dts * stream.timeBase;
// Both clips rescale one session clock into each stream's time base, so mapped
// timestamps can differ by a rounding tick.
const tolerance = (stream: ListedStream) => Math.max(stream.timeBase * 1.5, 0.0005);

function nearest(stream: ListedStream, time: number): number {
   let low = 0,
      high = stream.packets.length - 1;
   while (low < high) {
      const middle = (low + high) >> 1;
      if (seconds(stream, stream.packets[middle]!) < time) low = middle + 1;
      else high = middle;
   }
   if (low > 0 && Math.abs(seconds(stream, stream.packets[low - 1]!) - time) <= Math.abs(seconds(stream, stream.packets[low]!) - time)) return low - 1;
   return low;
}

/**
 * Map `inner` into `outer` at `offset`. "extends" means inner continues past
 * outer's end, as a newer clip does. "inside" means inner lies wholly within
 * outer. Returns the outer index of each track's first shared packet, or why
 * the clips do not line up.
 */
function align(outer: PacketListing, inner: PacketListing, offset: number, mode: "extends" | "inside"): number[] | string {
   const cuts: number[] = [];
   for (const [position, innerStream] of inner.streams.entries()) {
      const outerStream = outer.streams[position]!;
      const outerPackets = outerStream.packets,
         innerPackets = innerStream.packets;
      if (!innerPackets.length || !outerPackets.length) return "A clip has an empty track.";
      const outerEnd = seconds(outerStream, outerPackets.at(-1)!);
      const limit = tolerance(outerStream);
      const first = seconds(innerStream, innerPackets[0]!) + offset;
      if (mode === "extends" && first > outerEnd + limit) {
         // The newer clip starts after the older one's last packet in this
         // track. Accept only an exact continuation, never a gap.
         const last = outerPackets.at(-1)!;
         if (Math.abs(first - (outerEnd + last.duration * outerStream.timeBase)) > limit) return "The clips leave a gap between them.";
         cuts.push(outerPackets.length);
         continue;
      }
      const start = nearest(outerStream, first);
      if (Math.abs(seconds(outerStream, outerPackets[start]!) - first) > limit) return "The clips' tracks do not line up.";
      // Every shared packet must be the same packet. A newer clip shares
      // everything through the older clip's end. An older clip inside a
      // newer one is shared entirely.
      const shared = mode === "extends" ? outerPackets.length - start : innerPackets.length;
      if (mode === "extends" ? innerPackets.length < shared : outerPackets.length - start < shared) return "The clips' shared footage is incomplete.";
      for (let step = 0; step < shared; step++) {
         const innerPacket = innerPackets[step]!,
            outerPacket = outerPackets[start + step]!;
         if (innerPacket.hash !== outerPacket.hash || innerPacket.size !== outerPacket.size) return "The clips' shared footage is different.";
         if (Math.abs(seconds(innerStream, innerPacket) + offset - seconds(outerStream, outerPacket)) > limit) return "The clips' tracks do not line up.";
      }
      cuts.push(start);
   }
   return cuts;
}

function sameFormat(a: PacketListing, b: PacketListing): boolean {
   return a.streams.length === b.streams.length && a.streams.every((stream, index) => stream.description === b.streams[index]!.description);
}

export function planMerge(older: PacketListing, newer: PacketListing): MergePlan {
   if (!sameFormat(older, newer)) return { kind: "refuse", reason: "The clips were recorded with different settings." };
   const video = older.streams.findIndex((stream) => stream.kind === "video");
   if (video < 0) return { kind: "refuse", reason: "The clips have no video track." };
   const olderVideo = older.streams[video]!,
      newerVideo = newer.streams[video]!;
   const first = newerVideo.packets[0];
   if (!first || !olderVideo.packets.length) return { kind: "refuse", reason: "A clip has no video." };
   const candidates: { offset: number; cuts: number[] }[] = [];
   for (const packet of olderVideo.packets) {
      if (packet.hash !== first.hash || packet.size !== first.size) continue;
      const offset = seconds(olderVideo, packet) - seconds(newerVideo, first);
      const cuts = align(older, newer, offset, "extends");
      if (typeof cuts !== "string") candidates.push({ offset, cuts });
   }
   if (candidates.length > 1) return { kind: "refuse", reason: "The clips' shared footage is ambiguous." };
   if (!candidates.length) {
      // The newer clip may already hold all of the older one.
      const olderFirst = olderVideo.packets[0]!;
      const holders = newerVideo.packets.filter((packet) => packet.hash === olderFirst.hash && packet.size === olderFirst.size);
      const contained = holders.filter((packet) => {
         const offset = seconds(newerVideo, packet) - seconds(olderVideo, olderFirst);
         return typeof align(newer, older, offset, "inside") !== "string";
      });
      if (contained.length === 1) return { kind: "contained" };
      return { kind: "refuse", reason: contained.length > 1 ? "The clips' shared footage is ambiguous." : "The clips do not share footage." };
   }
   const { offset, cuts } = candidates[0]!;
   const expected = older.streams.map((stream, index) => [
      ...stream.packets.slice(0, cuts[index]).map((packet) => ({ time: seconds(stream, packet), size: packet.size, hash: packet.hash })),
      ...newer.streams[index]!.packets.map((packet) => ({ time: seconds(newer.streams[index]!, packet) + offset, size: packet.size, hash: packet.hash })),
   ]);
   const videoExpected = expected[video]!;
   const lastVideo = newerVideo.packets.at(-1)!;
   return {
      kind: "join",
      offset,
      cuts,
      olderCounts: older.streams.map((stream) => stream.packets.length),
      expected,
      duration: videoExpected.at(-1)!.time + lastVideo.duration * newerVideo.timeBase - videoExpected[0]!.time,
   };
}

/** The merged file must hold exactly the planned packets, in order, at the planned times. */
export function verifyMerged(listing: PacketListing, plan: Extract<MergePlan, { kind: "join" }>): string | null {
   if (listing.streams.length !== plan.expected.length) return "The merged clip has a different number of tracks.";
   const video = listing.streams.findIndex((stream) => stream.kind === "video");
   if (video < 0) return "The merged clip has no video track.";
   const originActual = seconds(listing.streams[video]!, listing.streams[video]!.packets[0]!);
   const originExpected = plan.expected[video]![0]!.time;
   for (const [index, stream] of listing.streams.entries()) {
      const expected = plan.expected[index]!;
      if (stream.packets.length !== expected.length) return "The merged clip is missing footage.";
      const limit = tolerance(stream);
      for (const [position, packet] of stream.packets.entries()) {
         const want = expected[position]!;
         if (packet.hash !== want.hash || packet.size !== want.size) return "The merged clip's footage differs from the originals.";
         if (Math.abs(seconds(stream, packet) - originActual - (want.time - originExpected)) > limit) return "The merged clip's tracks are out of sync.";
      }
   }
   return null;
}

async function listPackets(path: string, options: MediaOptions = {}): Promise<PacketListing> {
   const text = await runMedia("ffmpeg", [...ffmpegBase, "-copyts", "-i", path, "-map", "0", "-c", "copy", "-f", "framehash", "-hash", "md5", "-"], {
      belowNormal: true,
      ...options,
   });
   return parsePacketListing(text);
}

async function formatStart(path: string, options: MediaOptions): Promise<number> {
   const text = await runMedia("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-of", "default=noprint_wrappers=1:nokey=1", path], options);
   const value = Number(text.trim());
   return Number.isFinite(value) ? value : 0;
}

/** Track names as stored, never the player's fallback names. */
async function trackNames(path: string, options: MediaOptions): Promise<Map<number, string>> {
   const text = await runMedia("ffprobe", ["-v", "error", "-show_entries", "stream=index:stream_tags=title,name", "-of", "json", path], options);
   const parsed = JSON.parse(text) as { streams?: { index?: number; tags?: { title?: string; name?: string } }[] };
   const names = new Map<number, string>();
   for (const stream of parsed.streams ?? []) {
      const name = stream.tags?.title?.trim() || stream.tags?.name?.trim();
      if (typeof stream.index === "number" && name) names.set(stream.index, name);
   }
   return names;
}

const concatPath = (path: string) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;

export interface MergeResult {
   kind: "merged" | "contained";
   duration: number;
   info?: MediaInfo;
}

/**
 * Write the merge of `older` and `newer` to `output` and verify it packet by
 * packet. Throws with a plain reason when the clips cannot merge losslessly.
 * Never touches either source.
 */
export async function mergeClips(older: string, newer: string, output: string, workFile: string, options: MediaOptions = {}): Promise<MergeResult> {
   const [olderListing, newerListing] = [await listPackets(older, options), await listPackets(newer, options)];
   const plan = planMerge(olderListing, newerListing);
   if (plan.kind === "refuse") throw new Error(plan.reason);
   if (plan.kind === "contained") return { kind: "contained", duration: 0 };
   const [olderStart, newerStart] = [await formatStart(older, options), await formatStart(newer, options)];
   // The concat demuxer starts the second file where the first file's stated
   // duration ends, after removing each file's own start time. Its automatic
   // H.264 conversion is off: it would add parameter sets to the seam keyframe.
   const duration = plan.offset - olderStart + newerStart;
   await writeFile(workFile, `ffconcat version 1.0\nfile ${concatPath(older)}\nduration ${duration.toFixed(6)}\nfile ${concatPath(newer)}\n`);
   try {
      const filters = plan.cuts.flatMap((cut, index) =>
         cut < plan.olderCounts[index]! ? [`-bsf:${index}`, `noise=drop=gte(n\\,${cut})*lt(n\\,${plan.olderCounts[index]})`] : []
      );
      // MP4 stores a track's name in user data that the concat demuxer drops.
      const names = [...(await trackNames(newer, options))].flatMap(([index, name]) => [`-metadata:s:${index}`, `title=${name}`]);
      const container = extname(output).toLowerCase() === ".mkv" ? ["-f", "matroska"] : ["-f", "mp4", "-movflags", "+faststart"];
      await runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-auto_convert",
            "0",
            "-i",
            workFile,
            "-map",
            "0",
            "-c",
            "copy",
            ...filters,
            "-map_metadata",
            "0",
            ...names,
            ...container,
            output,
         ],
         { belowNormal: true, ...options }
      );
      const problem = verifyMerged(await listPackets(output, options), plan);
      if (problem) throw new Error(problem);
      const [info, newerInfo] = [await probe(output), await probe(newer)];
      if (info.tracks.map((track) => track.title).join("\n") !== newerInfo.tracks.map((track) => track.title).join("\n"))
         throw new Error("The merged clip lost its audio track names.");
      return { kind: "merged", duration: plan.duration, info };
   } catch (error) {
      await rm(output, { force: true });
      throw error;
   } finally {
      await rm(workFile, { force: true });
   }
}
