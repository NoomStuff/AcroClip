import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePacketListing, planMerge, verifyMerged } from "./clip-merge";

const md5 = (value: string) => createHash("md5").update(value).digest("hex");
// One capture session: 30 fps video with a keyframe every second and 48 kHz
// audio whose silent packets are byte-identical, like real recordings.
interface SessionPacket {
   stream: number;
   time: number;
   duration: number;
   size: number;
   hash: string;
   keyframe: boolean;
}
function session(seconds: number, quietAudio = true): SessionPacket[] {
   const packets: SessionPacket[] = [];
   for (let frame = 0; frame < seconds * 30; frame++)
      packets.push({ stream: 0, time: frame / 30, duration: 1 / 30, size: frame % 30 ? 400 : 60000, hash: md5(`video ${frame}`), keyframe: frame % 30 === 0 });
   for (let block = 0; block * 1024 < seconds * 48000; block++)
      for (const stream of [1, 2])
         packets.push({
            stream,
            time: 0.002 + (block * 1024) / 48000,
            duration: 1024 / 48000,
            size: 6,
            hash: quietAudio ? md5("silence") : md5(`audio ${stream} ${block}`),
            keyframe: true,
         });
   return packets.sort((a, b) => a.time - b.time || a.stream - b.stream);
}
// The recorder starts a clip at a keyframe and measures every track from it.
function clip(packets: SessionPacket[], from: number, to: number, description = "codec_id=h264"): string {
   const keyframe = packets.find((packet) => packet.stream === 0 && packet.keyframe && packet.time >= from - 1e-9)!;
   const origin = keyframe.time;
   const timeBase = (stream: number) => (stream === 0 ? 15360 : 48000);
   const lines = [
      "#format: frame checksums",
      "#version: 2",
      "#hash: MD5",
      `#extradata 0,  58, ${md5(description)}`,
      "#tb 0: 1/15360",
      "#media_type 0: video",
      `#codec_id 0: ${description}`,
      "#tb 1: 1/48000",
      "#media_type 1: audio",
      "#codec_id 1: aac",
      "#tb 2: 1/48000",
      "#media_type 2: audio",
      "#codec_id 2: aac",
      "#stream#, dts,        pts, duration,     size, hash",
   ];
   for (const packet of packets) {
      if (packet.time < origin - 1e-9 || packet.time >= to - 1e-9) continue;
      const tb = timeBase(packet.stream);
      const dts = Math.round((packet.time - origin) * tb);
      lines.push(`${packet.stream}, ${dts}, ${dts}, ${Math.round(packet.duration * tb)}, ${packet.size}, ${packet.hash}`);
   }
   return lines.join("\n");
}

describe("lossless clip merging", () => {
   const recorded = session(14);
   const older = parsePacketListing(clip(recorded, 0, 6));
   const newer = parsePacketListing(clip(recorded, 3, 10));

   it("keeps the older clip up to the newer clip's first packet in every track", () => {
      const plan = planMerge(older, newer);
      expect(plan.kind).toBe("join");
      if (plan.kind !== "join") return;
      expect(plan.offset).toBeCloseTo(3, 6);
      expect(plan.cuts[0]).toBe(90);
      // Silent audio matches everywhere by content, so its seam comes from the video's offset.
      expect(plan.cuts[1]).toBe(141);
      expect(plan.cuts[2]).toBe(141);
      expect(plan.duration).toBeCloseTo(10, 3);
   });

   it("accepts only the planned packets at the planned times", () => {
      const plan = planMerge(older, newer);
      if (plan.kind !== "join") throw new Error("expected a join");
      const merged = parsePacketListing(clip(recorded, 0, 10));
      expect(verifyMerged(merged, plan)).toBeNull();
      const lines = clip(recorded, 0, 10).split("\n");
      const shifted = lines.map((line) =>
         line.startsWith("1, ") ? line.replace(/^1, (\d+), (\d+),/, (_m, a, b) => `1, ${Number(a) + 960}, ${Number(b) + 960},`) : line
      );
      expect(verifyMerged(parsePacketListing(shifted.join("\n")), plan)).toMatch(/out of sync/);
      const missing = lines.filter((_line, index) => index !== 200);
      expect(verifyMerged(parsePacketListing(missing.join("\n")), plan)).toMatch(/missing footage/);
      expect(verifyMerged(parsePacketListing(clip(session(14, false), 0, 10)), plan)).toMatch(/differs/);
   });

   it("refuses clips from different sessions, settings or with a gap", () => {
      expect(planMerge(older, parsePacketListing(clip(session(14, false), 3, 10)))).toMatchObject({ kind: "refuse" });
      expect(planMerge(older, parsePacketListing(clip(recorded, 3, 10, "hevc")))).toEqual({
         kind: "refuse",
         reason: "The clips were recorded with different settings.",
      });
      expect(planMerge(older, parsePacketListing(clip(recorded, 7, 12)))).toMatchObject({ kind: "refuse", reason: "The clips do not share footage." });
   });

   it("recognizes a newer clip that already holds all of the older one", () => {
      expect(planMerge(parsePacketListing(clip(recorded, 4, 6)), parsePacketListing(clip(recorded, 3, 10)))).toEqual({ kind: "contained" });
   });

   it("ignores side data columns and rejects unreadable listings", () => {
      const withSideData = clip(recorded, 0, 2).replace(/^(1, \d+, \d+, \d+, 6, [\da-f]{32})$/m, "$1, S=1, 10, caf40ffb739a3cc81f10824f506b1bfc");
      expect(parsePacketListing(withSideData).streams[1]!.packets.length).toBe(parsePacketListing(clip(recorded, 0, 2)).streams[1]!.packets.length);
      expect(() => parsePacketListing("0, 1, 1, 1, 1, nothex")).toThrow();
   });
});
