import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

if (process.platform !== "win32") throw new Error("This real fullscreen proof requires Windows");
const mode = process.argv[2] ?? "app";
assert(["app", "screen", "transition", "auto"].includes(mode), "Expected app, screen, transition or auto");
const folder = path.resolve(".cache/native-fullscreen", randomUUID());
await mkdir(folder, { recursive: true });
const runtime = path.resolve(process.env["ATTACLIP_FULLSCREEN_RUNTIME"] ?? "resources/recorder");
const fixture = spawn(
   path.resolve(".cache/native-tests/Release/attaclip-d3d-fixture.exe"),
   ["AttaClip fullscreen regression", "997", "--attaclip-catalog-proof", mode === "transition" ? "--fullscreen-after" : "--fullscreen"],
   { stdio: "pipe" }
);
let handle = "";
let fixtureLog = "";
fixture.stderr.on("data", (value: Buffer) => {
   fixtureLog += value.toString();
});
fixture.stdout.once("data", (value: Buffer) => {
   handle = value.toString().trim();
});
interface Event {
   event: string;
   message?: string;
   captureMethod?: string;
   availableSeconds?: number;
   waiting?: boolean;
   requestId?: string;
   id?: string;
   windows?: Array<{ id: string; executable: string; pid: number; arguments?: string }>;
}
const events: Event[] = [];
const logs: string[] = [];
const helper = spawn(path.join(runtime, "attaclip-recorder.exe"), [runtime], { cwd: runtime, stdio: "pipe", windowsHide: true });
helper.stderr.on("data", (value: Buffer) => logs.push(value.toString()));
createInterface({ input: helper.stdout }).on("line", (value) => events.push(JSON.parse(value) as Event));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const send = (value: Record<string, unknown>): void => {
   helper.stdin.write(`${JSON.stringify(value)}\n`);
};
async function wait(predicate: (value: Event) => boolean): Promise<Event> {
   const deadline = Date.now() + 20_000;
   while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      if (helper.exitCode !== null) throw new Error(`Recorder exited ${helper.exitCode}`);
      await delay(20);
   }
   throw new Error(`Timed out: ${JSON.stringify(events)}`);
}
try {
   await wait((value) => value.event === "ready");
   const fixtureDeadline = Date.now() + 5000;
   while (!handle && Date.now() < fixtureDeadline) await delay(20);
   if (mode !== "transition") assert(fixtureLog.includes("fullscreen:"), "Actual DXGI fullscreen was not established");
   assert(
      !logs.join("").match(/update_hook_file: source graphics-hook(?:32|64)\.dll missing/),
      "OBS hook setup must find shipped assets without relying on cached hook files"
   );
   assert(handle);
   send({ action: "candidates" });
   const candidates = await wait((value) => value.event === "candidates");
   const candidate = candidates.windows?.find((value) => value.id === `window:${handle}:0`);
   assert(candidate, "Exact fixture HWND absent from candidates");
   assert.equal(candidate.pid, fixture.pid);
   assert(
      candidate.arguments?.includes("--attaclip-catalog-proof"),
      "Verified process arguments must support catalog entries that distinguish games sharing a runtime executable"
   );
   send({
      action: "start",
      id: "start",
      sourceKind: mode === "screen" ? "screen" : mode === "auto" ? "auto" : "app",
      resolvedKind: "app",
      sourceId: mode === "screen" ? "screen:fixture" : candidate.id,
      ...(mode === "screen"
         ? {
              bounds: (() => {
                 const match = /fullscreen:(-?\d+):(-?\d+):(\d+):(\d+)/.exec(fixtureLog);
                 assert(match, "The fullscreen fixture must identify its exact monitor");
                 return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
              })(),
           }
         : {}),
      sourceName: "D3D fixture",
      pid: candidate.pid,
      clipSeconds: 2,
      quality: "custom",
      customWidth: 640,
      customHeight: 360,
      customFPS: 30,
      customCQ: 23,
      captureAudio: true,
      microphone: false,
   });
   const start = await wait((value) => value.id === "start");
   assert.equal(start.event, "response", start.message ?? "Could not start game capture");
   let active: Event | undefined;
   let requestedFullscreen = false;
   for (let i = 0; i < 80; i++) {
      const before = events.length;
      send({ action: "status", id: `status-${i}` });
      await wait((value) => value.id === `status-${i}`);
      active = events.slice(before).find((value) => value.event === "status");
      if (mode === "transition" && !requestedFullscreen && active?.waiting === false && (active.availableSeconds ?? 0) >= 1) {
         assert.equal(active.captureMethod, "window");
         fixture.stdin.write("fullscreen\n");
         requestedFullscreen = true;
      }
      if ((active?.availableSeconds ?? 0) >= 2 && fixtureLog.includes("fullscreen:") && (mode === "screen" || active?.captureMethod === "game")) break;
      await delay(250);
   }
   assert.equal(active?.waiting, false);
   assert(fixtureLog.includes("fullscreen:"), "Actual DXGI fullscreen was not established");
   if (mode === "transition") {
      assert(
         events.some((event) => event.event === "status" && event.captureMethod === "window" && event.waiting === false),
         "The transition must first deliver windowed capture before switching methods"
      );
   }
   if (mode !== "screen") assert.equal(active?.captureMethod, "game", "Fullscreen App and Auto must capture the exact Direct3D target");
   else assert.equal(active?.waiting, false, "The selected monitor must deliver an image");
   const file = path.join(folder, "game.mkv");
   send({ action: "save", requestId: "game", requestedAt: Date.now(), path: file });
   const saved = await wait((value) => value.requestId === "game" && ["saved", "error"].includes(value.event));
   assert.equal(saved.event, "saved", saved.message ?? "Could not save game capture");
   const decode = spawnSync(path.resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", file, "-f", "null", "-"], {
      encoding: "utf8",
      windowsHide: true,
   });
   assert.equal(decode.status, 0, decode.stderr);
   const pixel = spawnSync(
      path.resolve("resources/media/ffmpeg.exe"),
      ["-v", "error", "-ss", "0.4", "-i", file, "-vf", "crop=2:2:iw/2:ih/2,signalstats,metadata=print:file=-", "-frames:v", "1", "-an", "-f", "null", "-"],
      { encoding: "utf8", windowsHide: true }
   );
   assert.equal(pixel.status, 0, pixel.stderr);
   const u = Number(/lavfi.signalstats.UAVG=([\d.]+)/.exec(pixel.stdout)?.[1]);
   const y = Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(pixel.stdout)?.[1]);
   assert(y > 35 && y < 160 && u > 140, `Expected actual blue D3D image, got Y/U ${y}/${u}`);
   const motion = spawnSync(
      path.resolve("resources/media/ffmpeg.exe"),
      ["-v", "error", "-i", file, "-vf", "crop=2:2:iw/2:ih/2,signalstats,metadata=print:file=-", "-an", "-f", "null", "-"],
      { encoding: "utf8", windowsHide: true }
   );
   assert.equal(motion.status, 0, motion.stderr);
   const lumas = [...motion.stdout.matchAll(/lavfi.signalstats.YAVG=([\d.]+)/g)].map((match) => Number(match[1]));
   assert(lumas.length >= 30 && Math.max(...lumas) - Math.min(...lumas) > 5, "Saved fullscreen footage must contain moving frames");
   assert(Math.min(...lumas) > 25, "Missing capture images must not enter the saved history as black frames");
   await writeFile(path.join(folder, "proof.json"), JSON.stringify({ mode, active, fixtureLog, fullDecode: true, movingFrames: lumas.length }, null, 2));
   send({ action: "stop" });
   send({ action: "exit" });
   await new Promise<void>((resolve) => helper.once("exit", () => resolve()));
   assert.equal(helper.exitCode, 0);
   console.log(`Actual fullscreen ${mode} capture, animated pixels and full decoding passed. Proof: ${folder}`);
} finally {
   if (helper.exitCode === null) helper.kill();
   fixture.kill();
   await writeFile(path.join(folder, "events.json"), JSON.stringify(events, null, 2));
   await writeFile(path.join(folder, "native.log"), logs.join(""));
}
