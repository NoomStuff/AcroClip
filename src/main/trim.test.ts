import { describe, expect, it } from "vitest";
import { maximumEncodedSeconds, nearestFrame, planTrim } from "./trim";
import type { PacketPoint, TrimSource, TrimStream } from "./trim";

function stream(index: number, type: string, codec: string): TrimStream {
   return {
      index,
      type,
      codec,
      pixelFormat: type === "video" ? "yuv420p" : "",
      width: type === "video" ? 1920 : 0,
      height: type === "video" ? 1080 : 0,
      sampleAspectRatio: "1:1",
      colorPrimaries: "",
      colorTransfer: "",
      colorSpace: "",
      colorRange: "",
      chromaLocation: "",
      fieldOrder: "progressive",
      frameRate: type === "video" ? 30 : 0,
      rotation: 0,
      sampleRate: type === "audio" ? 48000 : 0,
      channels: type === "audio" ? 2 : 0,
      channelLayout: "",
      timeBase: 1 / 90000,
      startTime: 0,
      attachedPicture: false,
      default: true,
      title: "",
   };
}
function source(overrides: Partial<TrimSource> = {}, codec = "h264"): TrimSource {
   return {
      path: "clip.mp4",
      extension: ".mp4",
      duration: 10,
      startOffset: 0,
      streams: [stream(0, "video", codec), stream(1, "audio", "aac"), stream(2, "audio", "aac")],
      ...overrides,
   };
}
// A recorder clip: 30 fps, a keyframe every second, decoded in display order.
function packets(seconds = 10, keyEvery = 30): PacketPoint[] {
   return Array.from({ length: seconds * 30 }, (_, frame) => ({ time: frame / 30, dts: frame / 30, key: frame % keyEvery === 0, duration: 1 / 30 }));
}
const plan = (start: number, end: number, value = source(), list = packets()) => planTrim(value, start, end, list, list);

describe("trim planning", () => {
   it("copies whole keyframe groups and encodes only up to the keyframes at each cut", () => {
      const result = plan(2.5, 7.5);
      expect(result.kind).toBe("cut");
      if (result.kind !== "cut") return;
      expect(result.spans.map(({ start, end, encode }) => [start, end, encode])).toEqual([
         [2.5, 3, true],
         [3, 7, false],
         [7, 7.5, true],
      ]);
      expect(result.encodedSeconds).toBeCloseTo(1);
      // Reading starts before the keyframe each span depends on.
      expect(result.spans[0]!.readStart).toBe(1);
      expect(result.copiedChecks).toEqual(expect.arrayContaining([3, 7 - 1 / 30]));
      expect(result.encodedChecks).toEqual(expect.arrayContaining([2.5, 7]));
   });
   it("copies without encoding when the start is a keyframe and the end is the clip's end", () => {
      const result = plan(3, 10);
      expect(result.kind === "cut" && result.spans.map(({ start, end, encode }) => [start, end, encode])).toEqual([[3, 10, false]]);
   });
   it("cuts other codecs too when no frame needs encoding", () => {
      expect(plan(3, 10, source({}, "hevc")).kind).toBe("cut");
   });
   it("explains that only H.264 cuts between keyframes", () => {
      const result = plan(2.5, 10, source({}, "hevc"));
      expect(result.kind === "unsupported" && result.reason).toMatch(/HEVC.*AttaCut/);
   });
   it("snaps cuts to the nearest frame", () => {
      const result = plan(2.51, 7.49);
      expect(result.kind === "cut" && [result.start, result.end]).toEqual([2.5, 7.5]);
   });
   it("stops copying before frames decoded after the last keyframe the range reaches", () => {
      // Two B-frames shown before each P-frame: P at 0.1 decodes before the B-frames at 0.033 and 0.067.
      const reordered: PacketPoint[] = [];
      for (let group = 0; group < 10; group++)
         for (let frame = 0; frame < 30; frame++) {
            const time = group + frame / 30;
            const lag = frame === 0 ? 0 : frame % 3 === 0 ? -2 / 30 : 1 / 30;
            reordered.push({ time, dts: time + lag - 1 / 30, key: frame === 0, duration: 1 / 30 });
         }
      // The frame just before the keyframe at 7 is decoded after it, so copying ends before that frame.
      reordered.find((packet) => Math.abs(packet.time - (7 - 1 / 30)) < 1e-9)!.dts = 7.01;
      const result = plan(2.5, 7.5, source(), reordered);
      expect(result.kind).toBe("cut");
      if (result.kind !== "cut") return;
      const copied = result.spans.find((span) => !span.encode)!;
      expect(copied.end).toBeCloseTo(7 - 1 / 30);
      expect(result.spans.at(-1)).toMatchObject({ start: copied.end, encode: true });
   });
   it("encodes a range with no keyframe inside it entirely", () => {
      const result = plan(1.2, 1.8);
      expect(result.kind === "cut" && result.spans.map(({ encode }) => encode)).toEqual([true]);
   });
   it("refuses to encode a long stretch of a clip with distant keyframes", () => {
      const sparse = packets(60, 30 * 60);
      const result = planTrim(source({ duration: 60 }), 0.5, 59, sparse, sparse);
      expect(result.kind).toBe("unsupported");
      expect(maximumEncodedSeconds).toBeLessThan(58.5);
   });
   it("needs the handles to have moved", () => {
      expect(plan(0, 10).kind).toBe("unsupported");
      expect(plan(4, 4.01).kind).toBe("unsupported");
   });
   it("keeps tracks a trim couldn't carry and formats it can't write untouched", () => {
      expect(plan(2.5, 7.5, source({ streams: [...source().streams, stream(3, "subtitle", "mov_text")] })).kind).toBe("unsupported");
      expect(plan(2.5, 7.5, source({ streams: [stream(0, "video", "h264"), stream(1, "audio", "pcm_s16le")] })).kind).toBe("unsupported");
      expect(plan(2.5, 7.5, source({ extension: ".avi" })).kind).toBe("unsupported");
      expect(plan(2.5, 7.5, source({ streams: [stream(1, "audio", "aac")] })).kind).toBe("unsupported");
   });
   it("keeps the first frame when a clip's video starts after zero", () => {
      const late = packets().map((packet) => ({ ...packet, time: packet.time + 0.07, dts: packet.dts + 0.07 }));
      expect(nearestFrame(late, 0, 10)).toBeCloseTo(0.07);
      expect(nearestFrame(late, 10, 10)).toBe(10);
   });
});
