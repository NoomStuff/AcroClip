import { describe, it, expect } from "vitest";
import { audioTrackTitle, mediaFailure } from "./media";

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
