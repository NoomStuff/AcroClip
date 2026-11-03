import { expect, it } from "vitest";
import { audioWarningDelay } from "./useAudioWarning";

it("gives startup and reconnecting sources time to recover without hiding lasting failures", () => {
   expect(audioWarningDelay("Microphone: Audio capture is starting")).toBe(5000);
   expect(audioWarningDelay("Capture audio: Audio capture is reconnecting")).toBe(5000);
   expect(audioWarningDelay("Waiting for audio source Game")).toBe(5000);
   expect(audioWarningDelay("Microphone: The selected audio device is unavailable")).toBe(1200);
   expect(audioWarningDelay("Audio capture health is unavailable. Repair the recorder installation")).toBe(1200);
   expect(audioWarningDelay("")).toBe(0);
});
