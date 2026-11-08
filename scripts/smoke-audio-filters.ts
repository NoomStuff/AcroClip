import "./interactive-test-guard";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

// Real application audio through the recorder's OBS filters: saved tracks and
// live meters must reflect each chain, and changes apply without a restart.
if (process.platform !== "win32") throw new Error("This audio filter proof requires Windows");
const folder = path.resolve(".cache/native-audio-filters", randomUUID());
await mkdir(folder, { recursive: true });
const fixtures = [997, 577].map((frequency) => {
   const child = spawn(
      path.resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"),
      [`AcroClip filter tone ${frequency} ${randomUUID()}`, String(frequency)],
      { stdio: "pipe" }
   );
   const handle = new Promise<string>((resolve) => child.stdout.once("data", (value: Buffer) => resolve(value.toString().trim())));
   return { child, handle };
});
const runtime = path.resolve("resources/recorder");
const helper = spawn(path.join(runtime, "acroclip-recorder.exe"), [runtime], { cwd: runtime, windowsHide: true, stdio: "pipe" });
interface Event {
   event: string;
   id?: string;
   requestId?: string;
   message?: string;
   additional?: Record<string, number>;
}
const events: Event[] = [],
   logs: string[] = [];
helper.stderr.on("data", (value: Buffer) => logs.push(value.toString()));
createInterface({ input: helper.stdout }).on("line", (line) => events.push(JSON.parse(line) as Event));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate: (event: Event) => boolean): Promise<Event> {
   const deadline = Date.now() + 20_000;
   while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      if (helper.exitCode !== null) throw new Error(`Recorder exited ${helper.exitCode}`);
      await delay(20);
   }
   throw new Error(`Native response timed out ${JSON.stringify(events.slice(-20))}`);
}
async function send(value: Record<string, unknown>): Promise<Event> {
   const id = randomUUID();
   helper.stdin.write(`${JSON.stringify({ ...value, id })}\n`);
   return wait((event) => event.id === id);
}
async function command(value: Record<string, unknown>): Promise<void> {
   const result = await send(value);
   assert.equal(result.event, "response", result.message ?? "Native command failed");
}
const decoder = process.env["ACROCLIP_TEST_FFMPEG"] ?? process.env["FFMPEG_PATH"] ?? path.resolve("resources/media/ffmpeg.exe");
const frequencies = [997, 577];
function levels(file: string, track: number): Record<string, number> {
   const result = spawnSync(decoder, ["-v", "error", "-i", file, "-map", `0:a:${track}`, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
   });
   if (result.error) throw result.error;
   assert.equal(result.status, 0, result.stderr.toString());
   const samples = Float32Array.from({ length: result.stdout.length / 2 }, (_, index) => result.stdout.readInt16LE(index * 2) / 32768).slice(24000, 72000);
   assert(samples.length > 20000, "Saved audio is too short to measure");
   return Object.fromEntries(
      frequencies.map((frequency) => {
         let power = 0,
            blocks = 0;
         for (let offset = 0; offset + 4800 <= samples.length; offset += 4800) {
            let a = 0,
               b = 0;
            for (let i = 0; i < 4800; i++) {
               const sample = samples[offset + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 4799));
               a += sample * Math.cos((2 * Math.PI * frequency * i) / 48000);
               b += sample * Math.sin((2 * Math.PI * frequency * i) / 48000);
            }
            power += ((4 * Math.hypot(a, b)) / 4800) ** 2;
            blocks++;
         }
         return [String(frequency), 20 * Math.log10(Math.max(1e-10, Math.sqrt(power / blocks)))];
      })
   );
}
const gain = (id: string, db: number, enabled = true) => ({ id, kind: "gain", enabled, settings: { db } });
const near = (actual: number, expected: number, tolerance: number, context: unknown) =>
   assert(
      Math.abs(actual - expected) < tolerance,
      `${actual.toFixed(2)} dB is not within ${tolerance} dB of ${expected.toFixed(2)} dB: ${JSON.stringify(context)}`
   );
let statusTimer: ReturnType<typeof setInterval> | undefined;
try {
   await wait((event) => event.event === "ready");
   // Match the app's status polling, which advances capture readiness and recovery.
   statusTimer = setInterval(() => {
      if (helper.exitCode === null && helper.stdin.writable) helper.stdin.write(`${JSON.stringify({ action: "status" })}\n`);
   }, 250);
   const handles = await Promise.all(fixtures.map((value) => value.handle));
   const extra = {
      id: "tone-b",
      name: "Filtered B",
      kind: "application",
      sourceId: `window:${handles[1]}:0`,
      pid: fixtures[1]!.child.pid,
      enabled: true,
      includeInMaster: true,
      volume: 1,
      muted: false,
   };
   // Track 0 is Master, 1 is the captured application (997 Hz), 2 is the extra source (577 Hz).
   await command({
      action: "start",
      allowSoftwareEncoder: process.env["ACROCLIP_NATIVE_TEST_SOFTWARE"] === "1",
      sourceKind: "app",
      sourceId: `window:${handles[0]}:0`,
      pid: fixtures[0]!.child.pid,
      sourceName: "Filter fixture",
      quality: "custom",
      customWidth: 640,
      customHeight: 360,
      customFPS: 24,
      customCQ: 28,
      clipSeconds: 2,
      captureAudio: true,
      captureVolume: 1,
      captureMuted: false,
      captureFilters: [gain("capture-gain", -12)],
      microphone: false,
      automaticMaster: true,
      sourceAudioPresent: true,
      audioSources: [{ ...extra, filters: [] }],
   });
   const measured: Record<string, Array<Record<string, number>>> = {};
   const capture = async (phase: string, change?: Record<string, unknown>) => {
      if (change) await command({ action: "audio", ...change });
      await delay(4000);
      const file = path.join(folder, `${phase}.mkv`);
      await command({ action: "save", path: file, requestId: phase, requestedAt: Date.now() });
      await wait((event) => event.event === "saved" && event.requestId === phase);
      measured[phase] = [0, 1, 2].map((track) => levels(file, track));
      const decode = spawnSync(decoder, ["-v", "error", "-i", file, "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
      assert.equal(decode.status, 0, decode.stderr);
      return measured[phase];
   };
   const extraAudio = (filters: unknown[]) => ({ source: "tone-b", volume: 1, muted: false, filters });
   const started = await capture("start-filtered");
   assert(started[1]!["997"]! > -60 && started[2]!["577"]! > -45, JSON.stringify(measured));
   const cleared = await capture("capture-cleared", { source: "capture", volume: 1, muted: false, filters: [] });
   near(cleared[1]!["997"]! - started[1]!["997"]!, 12, 1.5, measured);
   const extraGain = await capture("extra-gain", extraAudio([gain("extra-gain", -12)]));
   near(extraGain[2]!["577"]! - cleared[2]!["577"]!, -12, 1.5, measured);
   near(extraGain[0]!["577"]! - cleared[0]!["577"]!, -12, 1.5, measured);
   near(extraGain[1]!["997"]! - cleared[1]!["997"]!, 0, 1, measured);
   const disabled = await capture("extra-disabled", extraAudio([gain("extra-gain", -12, false)]));
   near(disabled[2]!["577"]! - cleared[2]!["577"]!, 0, 1, measured);
   const stacked = await capture("extra-stacked", extraAudio([gain("first", -6), gain("second", -6)]));
   near(stacked[2]!["577"]! - cleared[2]!["577"]!, -12, 1.5, measured);
   const equalized = await capture("extra-equalizer", extraAudio([{ id: "eq", kind: "equalizer", enabled: true, settings: { low: -20, mid: 0, high: 0 } }]));
   assert(cleared[2]!["577"]! - equalized[2]!["577"]! > 10, `The low band did not attenuate 577 Hz: ${JSON.stringify(measured)}`);
   // Every other bundled filter runs together, at defaults, on live audio without stopping capture.
   await capture(
      "every-filter",
      extraAudio(
         ["noise-suppression", "noise-gate", "compressor", "limiter", "expander", "upward-compressor", "equalizer", "invert-polarity"].map((kind) => ({
            id: `all-${kind}`,
            kind,
            enabled: true,
            settings: {},
         }))
      )
   );
   const restored = await capture("extra-cleared", extraAudio([]));
   near(restored[2]!["577"]! - cleared[2]!["577"]!, 0, 1, measured);
   for (const filters of [[{ id: "bad", kind: "vst", enabled: true, settings: {} }], [gain("bad", 90)], [gain("same", 0), gain("same", 0)]]) {
      const rejected = await send({ action: "audio", ...extraAudio(filters) });
      assert.equal(rejected.event, "error", `An invalid filter chain was accepted: ${JSON.stringify(filters)}`);
   }
   await command({ action: "stop" });
   // Settings meters run before capture and must show filtered levels too.
   await command({ action: "monitor-audio", enabled: true, audioSources: [{ ...extra, filters: [gain("meter", -30)] }], applicationPid: process.pid });
   const peak = async () => {
      await delay(500);
      const start = events.length;
      await delay(2000);
      return Math.max(0, ...events.slice(start).map((event) => event.additional?.["tone-b"] ?? 0));
   };
   const quiet = await peak();
   await command({ action: "audio", ...extraAudio([]) });
   const loud = await peak();
   assert(loud - quiet > 0.3, `Monitor meters ignored the filter: ${quiet} then ${loud}`);
   await command({ action: "monitor-audio", enabled: false });
   if (statusTimer) clearInterval(statusTimer);
   helper.stdin.write('{"action":"exit"}\n');
   await new Promise<void>((resolve) => helper.once("exit", () => resolve()));
   assert.equal(helper.exitCode, 0);
   await writeFile(path.join(folder, "measurements.json"), JSON.stringify({ measured, meters: { quiet, loud } }, null, 2));
   console.log("Actual Windows application audio filters, live chain changes, master routing, validation and meters passed", folder);
} finally {
   if (statusTimer) clearInterval(statusTimer);
   for (const fixture of fixtures) fixture.child.kill();
   if (helper.exitCode === null) helper.kill();
   await writeFile(path.join(folder, "native.log"), logs.join(""));
   await writeFile(path.join(folder, "events.json"), JSON.stringify(events, null, 2));
}
