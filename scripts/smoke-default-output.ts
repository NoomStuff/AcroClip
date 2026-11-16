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

type Event = { event: string; id?: string; requestId?: string; message?: string; availableSeconds?: number; audioWarning?: string };
const events: Event[] = [],
   logs: string[] = [],
   tones: Array<ReturnType<typeof spawn>> = [];
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const endpoint = (...args: string[]) => {
   const result = spawnSync(fixture, args, { windowsHide: true, encoding: "utf8" });
   assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
   return result.stdout;
};
assert.ok(endpoint("list").split(/\r?\n/).includes(second), "The second private output must be active");
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

   await tone(first, 1201);
   await tone(second, 1499);
   await healthyWindow();
   const late = await save("late-sessions");
   const lateTones = { oldOutput: toneAt(1, 1201, late), newDefault: toneAt(1, 1499, late), kept: toneAt(1, 811, late) };
   assert.ok(lateTones.oldOutput < -70, `A process that starts on a non-default output must stay out of Desktop: ${JSON.stringify(lateTones)}`);
   assert.ok(lateTones.newDefault > -60 && lateTones.kept > -60, `Desktop must carry the new default and the kept app: ${JSON.stringify(lateTones)}`);
   await command("stop");
   console.log(
      "Desktop audio kept an app across a default output change, and new captures still come from the default",
      JSON.stringify({ original, kept, lateTones })
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
