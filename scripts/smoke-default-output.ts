import "./interactive-test-guard";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Screen capture keeps an app's audio in Desktop after the default output changes, while that
// app stays on the output it started on. A process that first plays on a non-default output
// still stays out, so a mixer replaying every app onto the real headset can't double them.
if (process.platform !== "win32") throw new Error("The default output proof requires Windows");
const first = process.env["ACROCLIP_TEST_RENDER_ENDPOINT_ID"],
   second = process.env["ACROCLIP_TEST_SECOND_RENDER_ENDPOINT_ID"];
if (!first || !second || first === second) throw new Error("The default output proof needs two private outputs");
const runtime = path.resolve("resources/recorder");
const fixture = path.resolve(".cache/native-tests/Release/acroclip-endpoint-tone.exe");
const folder = path.resolve(".cache/native-default-output", randomUUID());
await mkdir(folder, { recursive: true });

type Event = {
   event: string;
   id?: string;
   requestId?: string;
   message?: string;
   availableSeconds?: number;
   audioWarning?: string;
   processes?: number[];
   listings?: number;
   framePacing?: string;
   totalFrames?: number;
   laggedFrames?: number;
};
const events: Event[] = [],
   logs: string[] = [],
   tones: Array<ReturnType<typeof spawn>> = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const endpoint = (...args: string[]) => {
   const result = spawnSync(fixture, args, { windowsHide: true, encoding: "utf8" });
   assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
   return result.stdout;
};
endpoint("enable", second);
const outputs = endpoint("list");
assert.ok(outputs.split(/\r?\n/).includes(second), `The second private output must be active, but only these are: ${outputs}`);
const setDefault = (id: string) => void endpoint("default", id);
async function tone(output: string, frequency: number) {
   const child = spawn(fixture, ["play", output, String(frequency)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
   tones.push(child);
   child.stderr!.on("data", (value: Buffer) => logs.push(`tone ${frequency}: ${value.toString()}`));
   await new Promise<void>((resolve, reject) => {
      createInterface({ input: child.stdout! }).on("line", (line) => line === "playing" && resolve());
      child.once("exit", (code) => reject(new Error(`The ${frequency} Hz tone exited ${code}: ${logs.join("")}`)));
   });
}
// The shared device stays busy for a moment after the other output's streams stop.
async function toneWhenFree(output: string, frequency: number) {
   for (let attempt = 1; ; attempt++) {
      try {
         return await tone(output, frequency);
      } catch (error) {
         if (attempt >= 20) throw error;
         tones.pop();
         await delay(500);
      }
   }
}
const toneAt = (track: number, frequency: number, file: string) => {
   const result = spawnSync(
      path.resolve("resources/media/ffmpeg.exe"),
      [
         "-hide_banner",
         "-i",
         file,
         "-map",
         `0:a:${track}`,
         "-af",
         `bandpass=f=${frequency}:width_type=h:w=10,bandpass=f=${frequency}:width_type=h:w=10,volumedetect`,
         "-f",
         "null",
         "-",
      ],
      { windowsHide: true, encoding: "utf8" }
   );
   assert.equal(result.status, 0, result.stderr);
   return Number(/mean_volume: (-?[\d.]+) dB/.exec(result.stderr)?.[1]);
};

setDefault(first);
const coverScript =
   "Add-Type -AssemblyName System.Windows.Forms; $form=New-Object System.Windows.Forms.Form; $form.FormBorderStyle='None'; $form.Bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $form.BackColor=[System.Drawing.Color]::FromArgb(34,85,170); $form.TopMost=$true; [System.Windows.Forms.Application]::Run($form)";
const screenCover = spawn("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(coverScript, "utf16le").toString("base64")], {
   stdio: "ignore",
   windowsHide: true,
});
const helper = spawn(path.join(runtime, "acroclip-recorder.exe"), [runtime], {
   cwd: runtime,
   windowsHide: true,
   stdio: "pipe",
   env: { ...process.env, ACROCLIP_NATIVE_TEST_LIFECYCLE: "1" },
});
helper.stderr.on("data", (value: Buffer) => logs.push(value.toString()));
createInterface({ input: helper.stdout }).on("line", (line) => events.push(JSON.parse(line) as Event));
async function wait(predicate: (event: Event) => boolean, after = 0): Promise<Event> {
   const end = Date.now() + 20000;
   while (Date.now() < end) {
      const result = events.slice(after).find(predicate);
      if (result) return result;
      await delay(30);
   }
   throw new Error(`Native recorder timed out: ${JSON.stringify(events.slice(-8))}`);
}
async function command(action: string, data: Record<string, unknown> = {}) {
   const id = randomUUID();
   helper.stdin.write(
      `${JSON.stringify({ ...(action === "start" ? { allowSoftwareEncoder: process.env["ACROCLIP_NATIVE_TEST_SOFTWARE"] === "1" } : {}), action, id, ...data })}\n`
   );
   const result = await wait((event) => event.id === id && ["response", "error"].includes(event.event));
   if (result.event === "error") throw new Error(result.message);
}
async function status() {
   const mark = events.length;
   await command("status");
   const result = events.slice(mark).find((event) => event.event === "status");
   assert.ok(result, "Status must be available");
   return result;
}
const save = async (name: string) => {
   const file = path.join(folder, `${name}.mkv`);
   await command("save", { requestId: name, requestedAt: Date.now(), path: file });
   const result = await wait((event) => ["saved", "error"].includes(event.event) && event.requestId === name);
   assert.equal(result.event, "saved", result.message ?? "");
   return file;
};
// Waits out a full two-second clip window, and Desktop must stay healthy for all of it.
const healthyWindow = async () => {
   for (let attempt = 0; attempt < 25; attempt++) {
      assert.equal((await status()).audioWarning ?? "", "", "Desktop audio must stay healthy");
      await delay(100);
   }
};
let statusTimer: ReturnType<typeof setInterval> | undefined;
try {
   await wait((event) => event.event === "ready");
   statusTimer = setInterval(() => {
      if (helper.exitCode === null && helper.stdin.writable) helper.stdin.write(`${JSON.stringify({ action: "status" })}\n`);
   }, 250);
   await delay(1800);
   await tone(first, 811);
   await command("start", {
      sourceKind: "screen",
      resolvedKind: "screen",
      screenIndex: 0,
      sourceName: "Controlled screen",
      recordingSizeVersion: 2,
      resolutionLimit: 720,
      quality: "custom",
      customFPS: 30,
      customCQ: 23,
      clipSeconds: 2,
      captureAudio: true,
      microphone: false,
      automaticMaster: true,
      sourceAudioPresent: true,
      sourceAudioName: "Source audio",
      audioSources: [],
   });
   for (let count = 0; count < 100 && ((await status()).availableSeconds ?? 0) < 1.3; count++) await delay(100);
   await healthyWindow();
   const before = await save("before-switch");
   const original = { master: toneAt(0, 811, before), desktop: toneAt(1, 811, before) };
   assert.ok(original.master > -60 && original.desktop > -60, `The tone must reach Desktop before the switch: ${JSON.stringify(original)}`);

   setDefault(second);
   await healthyWindow();
   const after = await save("after-switch");
   const kept = { master: toneAt(0, 811, after), desktop: toneAt(1, 811, after) };
   assert.ok(
      Math.abs(kept.desktop - original.desktop) < 1.5 && Math.abs(kept.master - original.master) < 1.5,
      `An app left on the old output must stay in Desktop and Master once: ${JSON.stringify({ original, kept })}`
   );

   // Both outputs are endpoints of one VB-CABLE device, which only one of them can play on at a
   // time. So the late checks run one output after the other.
   await tone(first, 1201);
   await healthyWindow();
   const late = await save("late-session");
   const lateTones = { oldOutput: toneAt(1, 1201, late), kept: toneAt(1, 811, late) };
   assert.ok(lateTones.oldOutput < -70, `A process that starts on a non-default output must stay out of Desktop: ${JSON.stringify(lateTones)}`);
   assert.ok(lateTones.kept > -60, `Desktop must still carry the kept app: ${JSON.stringify(lateTones)}`);

   for (const child of tones.splice(0)) child.kill();
   await toneWhenFree(second, 1499);
   await healthyWindow();
   const fresh = await save("new-default");
   const freshTone = toneAt(1, 1499, fresh);
   assert.ok(freshTone > -60, `Desktop must carry an app on the new default: ${freshTone}`);
   // Desktop audio lists sessions when Windows reports a change, not on a timer. A new app must
   // join well before the 2 s safety listing, every time, and a quiet stretch must stay quiet.
   const activity = async () => {
      const id = randomUUID();
      const mark = events.length;
      helper.stdin.write(`${JSON.stringify({ action: "test-desktop-audio", id })}\n`);
      const found = await wait((event) => event.event === "desktop-audio" && event.id === id, mark);
      return { processes: found.processes ?? [], listings: found.listings ?? 0 };
   };
   const joins: number[] = [];
   for (const frequency of [601, 701, 907]) {
      const started = performance.now();
      await tone(second, frequency);
      const pid = tones.at(-1)!.pid!;
      while (!(await activity()).processes.includes(pid)) {
         assert.ok(performance.now() - started < 3000, `A ${frequency} Hz tone never joined Desktop audio`);
         await delay(10);
      }
      joins.push(Math.round(performance.now() - started));
   }
   assert.ok(Math.max(...joins) < 600, `New apps must join Desktop audio as Windows reports them: ${JSON.stringify(joins)} ms`);
   const quietStart = (await activity()).listings;
   await delay(4000);
   const quietListings = (await activity()).listings - quietStart;
   assert.ok(quietListings <= 4, `Desktop audio must not list sessions while nothing changes: ${quietListings} listings in 4 s`);
   // Level messages only flow while the app shows meters. One already on its way may still arrive.
   const levelsDuring = async (shown: boolean) => {
      helper.stdin.write(`${JSON.stringify({ action: "meters", shown })}\n`);
      await delay(200);
      const mark = events.length;
      await delay(1000);
      return events.slice(mark).filter((event) => event.event === "audio-levels").length;
   };
   const hiddenLevels = await levelsDuring(false);
   const shownLevels = await levelsDuring(true);
   assert.equal(hiddenLevels, 0, `No level messages may be sent while meters are hidden: ${hiddenLevels} in 1 s`);
   assert.ok(shownLevels > 5, `Level messages must flow again once meters are shown: ${shownLevels} in 1 s`);
   // libOBS paces frames on a timer wait instead of spinning, without making frames late.
   const pacingId = randomUUID();
   const pacingMark = events.length;
   helper.stdin.write(`${JSON.stringify({ action: "test-lifecycle", id: pacingId })}\n`);
   const pacing = await wait((event) => event.event === "lifecycle" && event.id === pacingId, pacingMark);
   assert.equal(pacing.framePacing, "timer", `Frame pacing must wait on the timer: ${pacing.framePacing}`);
   const laggedShare = (pacing.laggedFrames ?? 0) / Math.max(1, pacing.totalFrames ?? 0);
   assert.ok((pacing.totalFrames ?? 0) > 100 && laggedShare < 0.02, `Frames must stay on time: ${pacing.laggedFrames} of ${pacing.totalFrames} lagged`);
   await command("stop");
   console.log(
      "Desktop audio kept an app across a default output change, and new captures still come from the default",
      JSON.stringify({
         original,
         kept,
         lateTones,
         freshTone,
         joins,
         quietListings,
         hiddenLevels,
         shownLevels,
         laggedFrames: pacing.laggedFrames,
         totalFrames: pacing.totalFrames,
      })
   );
} finally {
   if (statusTimer) clearInterval(statusTimer);
   for (const child of tones) child.kill();
   screenCover.kill();
   try {
      setDefault(first);
   } catch (error) {
      logs.push(`Restoring the default output failed: ${String(error)}`);
   }
   helper.stdin.write(`${JSON.stringify({ action: "exit" })}\n`);
   await Promise.race([new Promise((resolve) => helper.once("exit", resolve)), delay(5000)]);
   if (helper.exitCode === null) helper.kill();
   await writeFile(path.join(folder, "native.log"), logs.join(""));
   await writeFile(path.join(folder, "events.json"), JSON.stringify(events, null, 2));
}
