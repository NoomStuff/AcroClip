import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Feedback } from "./feedback";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(() => true), supported: vi.fn(() => true), show: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists }));
vi.mock("electron", () => ({
   nativeImage: { createFromPath: () => ({ resize: () => ({ toDataURL: () => "data:image/png;base64,fallback" }) }) },
   Notification: class {
      static isSupported = mocks.supported;
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
   feedback.show("Clip saving...", false, true, { visual: false, sound: "clip-saving.wav" });
   feedback.show("Clip saved", false, false, { visual: false, sound: "clip-saved.wav" });
   const messages = String(child.stdin.read())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
   expect(messages).toMatchObject([
      { visual: false, saving: true, sound: "clip-saving.wav" },
      { visual: false, saving: false, sound: "clip-saved.wav" },
   ]);
   expect(mocks.spawn).toHaveBeenCalledTimes(1);
   expect(mocks.show).not.toHaveBeenCalled();
});
it("uses request artwork with an app icon fallback", () => {
   const { feedback, child } = helper();
   feedback.show("Clip saving...", false, true, { artwork: "data:image/png;base64,game", detail: "HASTE" });
   feedback.show("Clip saved");
   const messages = String(child.stdin.read())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
   expect(messages).toMatchObject([{ artwork: "data:image/png;base64,game", detail: "HASTE" }, { artwork: "data:image/png;base64,fallback" }]);
});
it("uses recording status graphics instead of thumbnail placeholders", () => {
   const { feedback, child } = helper();
   feedback.show("Starting recording...", false, true, { recordingStatus: "starting", replay: false });
   const message: unknown = JSON.parse(String(child.stdin.read()).trim());
   expect(message).toMatchObject({ recordingStatus: "starting", artwork: "", replay: false, saving: true });
});
it("ships distinct WAV sound files with audio data", async () => {
   const files = ["clip-saving", "clip-saved", "recording-starting", "recording-started", "recording-stopped", "critical-error"];
   const sounds = await Promise.all(files.map((file) => readFile(new URL(`../../resources/feedback/${file}.wav`, import.meta.url))));
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
      expect(format?.length).toBeGreaterThanOrEqual(16);
      expect(format!.readUInt16LE(2)).toBeGreaterThan(0);
      expect(format!.readUInt32LE(4)).toBeGreaterThan(0);
      expect(chunks.get("data")?.length).toBeGreaterThan(0);
   }
   expect(sounds[0]!.equals(sounds[1]!)).toBe(false);
});
