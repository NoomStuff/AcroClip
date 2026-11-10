import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { Feedback } from "./feedback";
import { feedbackSoundFiles } from "./notice-routing";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(() => true), supported: vi.fn(() => true), show: vi.fn(), created: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists }));
vi.mock("electron", () => ({
   nativeImage: { createFromPath: () => ({ resize: () => ({ toDataURL: () => "data:image/png;base64,fallback" }) }) },
   Notification: class {
      static isSupported = mocks.supported;
      constructor(options: unknown) {
         mocks.created(options);
      }
      on = vi.fn();
      close = vi.fn();
      show = mocks.show;
   },
}));
const instances: Feedback[] = [];
afterEach(() => {
   for (const feedback of instances.splice(0)) feedback.close();
   vi.useRealTimers();
   vi.clearAllMocks();
   mocks.exists.mockReturnValue(true);
});
function helper() {
   const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
   vi.spyOn(child.stdin, "write");
   mocks.spawn.mockReturnValue(child);
   const feedback = new Feedback("notifier", vi.fn(), "icon.png");
   instances.push(feedback);
   return { feedback, child };
}
it("does not start a helper when visual feedback and sound are disabled", () => {
   const { feedback } = helper();
   feedback.show("Clip saved", false, false, { visual: false });
   expect(mocks.spawn).not.toHaveBeenCalled();
});
it("falls back to system notifications when the helper is missing", () => {
   const { feedback } = helper();
   mocks.exists.mockReturnValue(false);
   feedback.show("Clip saved");
   expect(mocks.spawn).not.toHaveBeenCalled();
   expect(mocks.show).toHaveBeenCalledOnce();
});
it.each(["error", "exit", "pipe"])("falls back once for the latest banner after a helper %s failure", (failure) => {
   const { feedback, child } = helper();
   feedback.show("Clip saving...", false, true);
   feedback.show("Clip saved");
   if (failure === "pipe") child.stdin.emit("error", new Error("Broken pipe"));
   else if (failure === "error") child.emit("error", new Error("Helper failed"));
   else child.emit("exit", 1);
   child.emit("exit", 1);
   expect(mocks.show).toHaveBeenCalledOnce();
   expect(child.kill).toHaveBeenCalledOnce();
   feedback.show("Recording stopped");
   expect(mocks.spawn).toHaveBeenCalledOnce();
   expect(mocks.show).toHaveBeenCalledTimes(2);
});
it("falls back on a display timeout even if the helper is alive", () => {
   vi.useFakeTimers();
   const { feedback, child } = helper();
   feedback.show("Clip saved");
   vi.advanceTimersByTime(2000);
   expect(mocks.show).toHaveBeenCalledOnce();
   expect(child.kill).toHaveBeenCalledOnce();
});
it("accepts only a matching, visible display acknowledgement", () => {
   vi.useFakeTimers();
   const { feedback, child } = helper();
   feedback.show("Saving", false, true);
   feedback.show("Saved");
   child.stdout.write('invalid\n{"event":"shown","id":"1","visible":true}\n');
   vi.advanceTimersByTime(1900);
   expect(mocks.show).not.toHaveBeenCalled();
   child.stdout.write('{"event":"shown","id":"2","visible":true}\n');
   vi.advanceTimersByTime(2000);
   expect(mocks.show).not.toHaveBeenCalled();
   child.stdout.write('{"event":"hidden","id":"2"}\n');
   child.emit("exit", 1);
   expect(mocks.show).not.toHaveBeenCalled();
});
it("falls back when the helper reports an invisible banner", () => {
   const { feedback, child } = helper();
   feedback.show("Saved");
   child.stdout.write('{"event":"shown","id":"1","visible":false}\n');
   expect(mocks.show).toHaveBeenCalledOnce();
});
it("ignores stale display acknowledgements and falls back for the current banner", () => {
   vi.useFakeTimers();
   const { feedback, child } = helper();
   feedback.show("Saving", false, true);
   feedback.show("Saved");
   child.stdout.write('{"event":"shown","id":"1","visible":true}\n');
   vi.advanceTimersByTime(2000);
   expect(mocks.show).toHaveBeenCalledOnce();
});
it.each([false, true])("respects preserveBanner=%s when a muted event precedes failure", (preserveBanner) => {
   const { feedback, child } = helper();
   feedback.show("Save failed", true);
   feedback.show("Starting", false, true, { visual: false, preserveBanner, sound: "starting.wav" });
   child.emit("exit", 1);
   expect(mocks.show).toHaveBeenCalledTimes(preserveBanner ? 1 : 0);
});
it("does not fall back for sound-only events or intentional shutdown", () => {
   vi.useFakeTimers();
   const { feedback, child } = helper();
   feedback.show("Starting", false, true, { visual: false, sound: "starting.wav" });
   child.emit("exit", 1);
   expect(mocks.show).not.toHaveBeenCalled();
   const next = helper();
   next.feedback.show("Saved");
   next.feedback.close();
   next.child.emit("exit", 0);
   vi.advanceTimersByTime(3000);
   expect(mocks.show).not.toHaveBeenCalled();
});
it("sends sound-only feedback and reuses the helper for the completion sound", () => {
   const { feedback, child } = helper();
   feedback.show("Saving clip…", false, true, { visual: false, sound: "clip-load.wav" });
   feedback.show("Clip saved", false, false, { visual: false, sound: "clip-success.wav" });
   const messages = vi.mocked(child.stdin.write).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
   expect(messages).toMatchObject([
      { visual: false, saving: true, ...(process.platform === "linux" ? {} : { sound: "clip-load.wav" }) },
      { visual: false, saving: false, ...(process.platform === "linux" ? {} : { sound: "clip-success.wav" }) },
   ]);
   expect(mocks.spawn).toHaveBeenCalledTimes(process.platform === "linux" ? 3 : 1);
   expect(mocks.show).not.toHaveBeenCalled();
});
it("uses request artwork with an app icon fallback", () => {
   const { feedback, child } = helper();
   feedback.show("Clip saving...", false, true, { artwork: "data:image/png;base64,game", detail: "HASTE" });
   feedback.show("Clip saved");
   const messages = vi.mocked(child.stdin.write).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
   expect(messages).toMatchObject([{ artwork: "data:image/png;base64,game", detail: "HASTE" }, { artwork: "data:image/png;base64,fallback" }]);
});
it("insets icons, including AcroClip's own, but lets clip thumbnails fill the tile", () => {
   const { feedback, child } = helper();
   feedback.show("Clip saved", false, false, { artwork: "data:image/png;base64,thumbnail" });
   feedback.show("Now capturing", false, false, { artwork: "data:image/png;base64,game", artworkIcon: true });
   feedback.show("Saved", false, false);
   const messages = vi.mocked(child.stdin.write).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
   expect(messages).toMatchObject([{ artworkIcon: false }, { artworkIcon: true }, { artwork: "data:image/png;base64,fallback", artworkIcon: true }]);
});
it("uses the app icon when a source thumbnail is empty", () => {
   const { feedback, child } = helper();
   feedback.show("Saving clip…", false, true, { artwork: "data:image/png;base64," });
   const messages = vi.mocked(child.stdin.write).mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
   expect(messages).toMatchObject([{ artwork: "data:image/png;base64,fallback", artworkIcon: true }]);
});
it("uses recording status graphics instead of thumbnail placeholders", () => {
   const { feedback, child } = helper();
   feedback.show("Starting capture...", false, true, { recordingStatus: "starting", replay: false });
   const message: unknown = JSON.parse(String(child.stdin.read()).trim());
   expect(message).toMatchObject({ recordingStatus: "starting", artwork: "", replay: false, saving: true });
});
it("ships exactly the routed sounds as trimmed PCM that every platform plays", async () => {
   const folder = new URL("../../resources/feedback/", import.meta.url);
   expect((await readdir(folder)).filter((file) => file.endsWith(".wav")).sort()).toEqual([...feedbackSoundFiles].sort());
   const sounds = await Promise.all(feedbackSoundFiles.map((file) => readFile(new URL(file, folder))));
   for (const sound of sounds) {
      expect(sound.toString("ascii", 0, 4)).toBe("RIFF");
      expect(sound.toString("ascii", 8, 12)).toBe("WAVE");
      const chunks = new Map<string, Buffer>();
      for (let offset = 12; offset + 8 <= sound.length;) {
         const size = sound.readUInt32LE(offset + 4);
         expect(offset + 8 + size).toBeLessThanOrEqual(sound.length);
         chunks.set(sound.toString("ascii", offset, offset + 4), sound.subarray(offset + 8, offset + 8 + size));
         offset += 8 + size + (size % 2);
      }
      const format = chunks.get("fmt ");
      const data = chunks.get("data");
      expect(format?.length).toBeGreaterThanOrEqual(16);
      // The sounds keep their original depth. PlaySound needs WAVE_FORMAT_EXTENSIBLE above 16 bits.
      const bits = format!.readUInt16LE(14);
      const tag = format!.readUInt16LE(0);
      if (bits === 16) expect(tag).toBe(1);
      else {
         expect(bits).toBe(24);
         expect(tag).toBe(0xfffe);
         // The extensible header's sub-format GUID starts with the PCM tag.
         expect(format!.readUInt16LE(24)).toBe(1);
      }
      const width = bits / 8;
      const sample = (at: number) => (width === 2 ? data!.readInt16LE(at) / 32768 : data!.readIntLE(at, 3) / 8388608);
      const channels = format!.readUInt16LE(2);
      const rate = format!.readUInt32LE(4);
      expect(data?.length).toBeGreaterThan(0);
      // A sound must end where it fades out. Dead air past that delays the next cue on some players.
      let quietFrames = 0;
      for (let frame = data!.length / (width * channels) - 1; frame >= 0; frame--) {
         let peak = 0;
         for (let channel = 0; channel < channels; channel++) peak = Math.max(peak, Math.abs(sample((frame * channels + channel) * width)));
         if (peak > 10 ** (-80 / 20)) break;
         quietFrames++;
      }
      // The cut fades over 80 ms, so only the end of that fade may sit below -80 dBFS.
      expect((quietFrames / rate) * 1000).toBeLessThan(100);
   }
   expect(new Set(sounds.map((sound) => sound.toString("base64"))).size).toBe(sounds.length);
});

it("falls back once for a correlated rendering failure", () => {
   const { feedback, child } = helper();
   feedback.show("Save failed", true);
   child.stdout.write('{"event":"failed","id":"1"}\n');
   child.emit("exit", 1);
   expect(mocks.show).toHaveBeenCalledOnce();
});
it("falls back when spawning the helper throws synchronously", () => {
   const { feedback } = helper();
   mocks.spawn.mockImplementationOnce(() => {
      throw new Error("Cannot start");
   });
   feedback.show("Saved");
   expect(mocks.show).toHaveBeenCalledOnce();
});

it("shows the banner's title and detail in a system notification, without reposting busy progress", () => {
   const { feedback } = helper();
   mocks.exists.mockReturnValue(false);
   feedback.show("Starting capture...", false, true, { detail: "Preparing capture" });
   feedback.show("Starting capture...", false, true, { detail: "Waiting for source" });
   feedback.show("Capture started", false, false, { detail: "Starfall" });
   feedback.show("Capture stopped unexpectedly", true, false, { errorTitle: "Capture stopped unexpectedly", detail: "Start capturing again." });
   expect(mocks.created.mock.calls.map(([options]) => options as { title: string; body: string })).toMatchObject([
      { title: "Starting capture...", body: "Preparing capture" },
      { title: "Capture started", body: "Starfall" },
      { title: "Capture stopped unexpectedly", body: "Start capturing again." },
   ]);
});
