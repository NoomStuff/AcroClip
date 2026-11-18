import { describe, it, expect } from "vitest";
import {
   audioTrackTitle,
   flatSpread,
   frameSpreads,
   mediaFailure,
   chooseShareRung,
   measuredRung,
   passQuantizer,
   pickThumbnailFrame,
   shareHeights,
} from "./media";

describe("imported audio track names", () => {
   it("uses ordinal names for generic MP4 handlers", () => {
      expect(audioTrackTitle({ handler_name: "SoundHandler" }, 0)).toBe("Master");
      expect(audioTrackTitle({ name: "Desktop", handler_name: "SoundHandler" }, 1)).toBe("Desktop");
      expect(audioTrackTitle({ handler_name: "Sound Media Handler" }, 1)).toBe("Audio 2");
      expect(audioTrackTitle({ title: "", handler_name: "AudioHandler" }, 2)).toBe("Audio 3");
   });
   it("preserves real track titles and useful handler names", () => {
      expect(audioTrackTitle({ title: "Microphone", handler_name: "SoundHandler" }, 1)).toBe("Microphone");
      expect(audioTrackTitle({ handler_name: "Desktop audio" }, 0)).toBe("Desktop audio");
   });
});

describe("ffmpeg failures", () => {
   it("keeps why ffmpeg stopped, not every broken frame of a damaged video", () => {
      const stderr = [
         "it with size 47432",
         "[h264 @ 0000020b707b0c40] missing picture in access unit with size 46450",
         "    Last message repeated 1 times",
         "[h264 @ 0000020b707b0c40] error while decoding MB 46 31, bytestream -29",
         "[vist#0:0/h264 @ 0000020b6eff7680] [dec:h264 @ 0000020b712c0940] Decode error rate 0.75 exceeds maximum 0.666667",
         "[vist#0:0/h264 @ 0000020b6eff7680] [dec:h264 @ 0000020b712c0940] Task finished with error code: -1145393733 (Error number -1145393733 occurred)",
         "[vist#0:0/h264 @ 0000020b6eff7680] [dec:h264 @ 0000020b712c0940] Terminating thread with return code -1145393733 (Error number -1145393733 occurred)",
         "",
      ].join("\r\n");
      expect(mediaFailure(stderr)).toBe("error while decoding MB 46 31, bytestream -29 Decode error rate 0.75 exceeds maximum 0.666667");
      expect(mediaFailure("[mov,mp4,m4a,3gp,3g2,mj2 @ 0000025dbbf9eb00] moov atom not found\n")).toBe("moov atom not found");
      expect(mediaFailure("")).toBe("");
   });
});

describe("thumbnail frame choice", () => {
   it("reads each frame's brightness spread from signalstats", () => {
      const stats = [
         "frame:0    pts:0       pts_time:0",
         "lavfi.signalstats.YLOW=16",
         "lavfi.signalstats.YHIGH=140",
         "frame:1    pts:10240   pts_time:1",
         "lavfi.signalstats.YLOW=2",
         "lavfi.signalstats.YHIGH=3",
         "frame:2    pts:20480   pts_time:2",
         "lavfi.signalstats.YLOW=9",
      ].join("\r\n");
      expect(frameSpreads(stats)).toEqual([124, 1, 0]);
   });
   it("takes the latest frame that shows something, else the most spread one", () => {
      expect(pickThumbnailFrame([120, 60, 2, 0])).toBe(1);
      expect(pickThumbnailFrame([120, 60])).toBe(1);
      expect(pickThumbnailFrame([4, 10, 0])).toBe(1);
      expect(pickThumbnailFrame([flatSpread, 0, flatSpread])).toBe(2);
      expect(pickThumbnailFrame([])).toBe(-1);
   });
});

describe("shareable rungs", () => {
   it("steps down from the clip's height, up to 1080p, to 360p", () => {
      expect(shareHeights(1440)).toEqual([1080, 720, 540, 360]);
      expect(shareHeights(1080)).toEqual([1080, 720, 540, 360]);
      expect(shareHeights(601)).toEqual([600, 540, 360]);
   });
   it("measures at 720p, or the clip's own height when smaller, at up to 60 fps", () => {
      expect(measuredRung({ height: 1080, frameRate: 144 })).toEqual({ height: 720, frameRate: 60 });
      expect(measuredRung({ height: 480, frameRate: 30 })).toEqual({ height: 480, frameRate: 30 });
   });
   it("picks the rung from how hard the measured pass had to quantize", () => {
      const clip = { height: 1080, frameRate: 60 };
      expect(chooseShareRung(clip, 27)).toEqual({ height: 1080, frameRate: 60 });
      expect(chooseShareRung(clip, 37)).toEqual({ height: 720, frameRate: 60 });
      expect(chooseShareRung(clip, 41)).toEqual({ height: 540, frameRate: 60 });
      expect(chooseShareRung(clip, 46)).toEqual({ height: 540, frameRate: 30 });
   });
   it("keeps a 30 fps clip's frame rate however hard it is", () => {
      expect(chooseShareRung({ height: 720, frameRate: 30 }, 50)).toEqual({ height: 540, frameRate: 30 });
      expect(chooseShareRung({ height: 360, frameRate: 30 }, 50)).toEqual({ height: 360, frameRate: 30 });
   });
});

describe("first-pass quantizer", () => {
   it("averages x264's per-frame quantizers", () => {
      const stats = [
         "#options: 1280x720 fps=60/1 timebase=1/60 bitdepth=8 cabac=1 ref=2",
         "in:0 out:0 type:I dur:2 cpbdur:2 q:30.00 aq:26.11 tex:0 mv:0 misc:0 imb:0 pmb:0 smb:0 d:- ref:;",
         "in:1 out:1 type:P dur:2 cpbdur:2 q:34.00 aq:31.10 tex:0 mv:0 misc:0 imb:0 pmb:0 smb:0 d:- ref:0 ;",
      ].join("\n");
      expect(passQuantizer(stats)).toBe(32);
      expect(passQuantizer("#options: none")).toBeUndefined();
   });
});
