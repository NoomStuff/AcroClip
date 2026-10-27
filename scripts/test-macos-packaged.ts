import "./interactive-test-guard";
import { _electron as electron, expect } from "@playwright/test";
import { closeTestApplication } from "./close-test-application";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { defaultPreferences } from "../src/shared/defaults";
import type { AdditionalAudioSource } from "../src/shared/types";

if (process.platform !== "darwin") throw new Error("Packaged Mac recording requires an actual macOS host.");
const run = promisify(execFile);
const folder = await mkdtemp(path.join(tmpdir(), "acroclip-mac-packaged-"));
const collection = path.join(folder, "clips");
await mkdir(collection);
const evidence = path.resolve(".cache/macos-packaged");
await mkdir(evidence, { recursive: true });
const fixtureContents = path.join(folder, "Fixture.app", "Contents");
await mkdir(path.join(fixtureContents, "MacOS"), { recursive: true });
await copyFile(path.resolve("native/macos/fixture-Info.plist"), path.join(fixtureContents, "Info.plist"));
const binary = path.join(fixtureContents, "MacOS", "fixture");
await run("swiftc", [path.resolve("native/macos/fixture.swift"), "-o", binary]);
const fixtureOutput = path.join(folder, "fixture-output.jsonl");
const fixture = spawn("open", ["-n", "-W", path.dirname(fixtureContents), "--args", fixtureOutput, "997", "bounded"], { stdio: ["ignore", "pipe", "pipe"] });
const fixtureErrors: string[] = [];
const fixtureHealth: Array<{ engineRunning: boolean; renderedFrames: number }> = [];
fixture.stderr.on("data", (data: Buffer) => fixtureErrors.push(data.toString()));
async function waitForFixture(outputPath = fixtureOutput) {
   const deadline = Date.now() + 20000;
   while (Date.now() < deadline) {
      const output = await readFile(outputPath, "utf8").catch(() => "");
      if (output.includes("\n")) {
         return z
            .object({
               pid: z.number().int().positive(),
               windowId: z.number().int().positive(),
               audioStarted: z.boolean(),
               windowPixels: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
            })
            .parse(JSON.parse(output.split("\n")[0]!));
      }
      await delay(50);
   }
   throw new Error("The synthetic Mac fixture did not start");
}
const identity = await waitForFixture().catch(async (error: unknown) => {
   await writeFile(`${fixtureOutput}.stop`, "");
   fixture.kill();
   throw error;
});
if (!identity.audioStarted) {
   await writeFile(`${fixtureOutput}.stop`, "");
   fixture.kill();
   throw new Error("The runner could not play the generated tone, so packaged audio capture cannot be proven");
}
const decoyContents = path.join(folder, "Decoy.app", "Contents");
await mkdir(path.join(decoyContents, "MacOS"), { recursive: true });
await writeFile(
   path.join(decoyContents, "Info.plist"),
   (await readFile(path.resolve("native/macos/fixture-Info.plist"), "utf8")).replace("dev.acroclip.capture-fixture", "dev.acroclip.capture-decoy")
);
await copyFile(binary, path.join(decoyContents, "MacOS", "fixture"));
const decoyOutput = path.join(folder, "decoy-output.jsonl");
const decoy = spawn("open", ["-n", "-W", path.dirname(decoyContents), "--args", decoyOutput, "1613", "compact"], { stdio: ["ignore", "ignore", "pipe"] });
decoy.stderr.on("data", (data: Buffer) => fixtureErrors.push(data.toString()));
const decoyIdentity = await waitForFixture(decoyOutput).catch(async (error: unknown) => {
   await writeFile(`${fixtureOutput}.stop`, "");
   await writeFile(`${decoyOutput}.stop`, "");
   fixture.kill();
   decoy.kill();
   throw error;
});
if (!decoyIdentity.audioStarted) {
   await writeFile(`${fixtureOutput}.stop`, "");
   await writeFile(`${decoyOutput}.stop`, "");
   fixture.kill();
   decoy.kill();
   throw new Error("The independent decoy tone did not start");
}
await writeFile(
   path.join(folder, "preferences.json"),
   JSON.stringify({
      ...defaultPreferences,
      collection,
      setupComplete: true,
      sourceKind: "app",
      sourceId: `window:${identity.windowId}:0`,
      quality: "custom",
      recordingSizeVersion: 2,
      resolutionLimit: 360,
      customFPS: 15,
      customCQ: 28,
      clipSeconds: 5,
      allowSoftwareEncoder: true,
      microphone: false,
      captureAudio: true,
      notifications: "off",
      sound: false,
      shortcut: "Control+Alt+Shift+F12",
   })
);
const executable =
   process.env["ACROCLIP_MAC_PACKAGED_EXE"] ?? path.resolve(`release/mac${process.arch === "arm64" ? "-arm64" : ""}/AcroClip.app/Contents/MacOS/AcroClip`);
let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
const recordingStates: unknown[] = [];
const applicationErrors: string[] = [];
const ffmpeg = path.resolve("resources/media/ffmpeg");
const ffprobe = path.resolve("resources/media/ffprobe");
async function tones(file: string, track: number) {
   const { stdout } = await run(ffmpeg, ["-v", "error", "-i", file, "-map", `0:a:${track}`, "-ac", "1", "-ar", "48000", "-t", "1", "-f", "f32le", "-"], {
      encoding: "buffer",
   });
   const count = stdout.length / 4;
   expect(count).toBeGreaterThanOrEqual(24000);
   return [997, 1613].map((frequency) => {
      let sine = 0;
      let cosine = 0;
      for (let index = 0; index < count; index++) {
         const sample = stdout.readFloatLE(index * 4);
         const phase = (2 * Math.PI * frequency * index) / 48000;
         sine += sample * Math.sin(phase);
         cosine += sample * Math.cos(phase);
      }
      return (2 * Math.hypot(sine, cosine)) / count;
   });
}
function onlyTone(tone: number[], selected: 0 | 1) {
   expect(tone[selected]).toBeGreaterThan(0.03);
   expect(tone[1 - selected]).toBeLessThan(tone[selected]! / 8);
}
async function verifyFixtureFrames(file: string) {
   const { stdout } = await run(
      ffmpeg,
      ["-v", "error", "-i", file, "-vf", "crop=2:2:iw/2:ih/2,scale=1:1", "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
      { encoding: "buffer" }
   );
   expect(stdout.length).toBeGreaterThanOrEqual(6);
   expect(stdout.length % 3).toBe(0);
   const classes = new Set<number>();
   for (let offset = 0; offset < stdout.length; offset += 3) {
      const color = [
         [228, 76, 102],
         [65, 184, 170],
      ].findIndex((fixtureColor) => fixtureColor.every((channel, index) => Math.abs(channel - stdout[offset + index]!) <= 22));
      expect(color).toBeGreaterThanOrEqual(0);
      classes.add(color);
   }
   expect([...classes].sort()).toEqual([0, 1]);
}
try {
   desktop = await electron.launch({
      executablePath: executable,
      args: ["--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: folder },
      timeout: 60000,
   });
   desktop.process().stderr?.on("data", (data: Buffer) => applicationErrors.push(data.toString()));
   const page = await desktop.firstWindow();
   expect((await page.evaluate(() => window.acroClip.state())).preferences).toMatchObject({ setupComplete: true, sourceKind: "app", recordingSizeVersion: 2 });
   await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeVisible();
   const candidates = await page.evaluate(() => window.acroClip.games());
   const selected = candidates.find((candidate) => candidate.pid === identity.pid);
   const other = candidates.find((candidate) => candidate.pid === decoyIdentity.pid);
   expect(selected).toBeDefined();
   expect(other).toBeDefined();
   const captureSources = await page.evaluate(() => window.acroClip.sources());
   const captureSource = captureSources.find((source) => source.kind === "app" && source.id.split(":")[1] === String(identity.windowId));
   await writeFile(
      path.join(evidence, "capture-source.json"),
      JSON.stringify(
         {
            windowId: identity.windowId,
            sources: captureSources.map(({ id, name, kind }) => ({ id, name, kind })),
            state: (await page.evaluate(() => window.acroClip.state())).recorder,
            selected: captureSource?.id,
         },
         null,
         2
      )
   );
   expect(captureSource, "The fixture window must be available through the actual source picker").toBeDefined();
   const audioSources: AdditionalAudioSource[] = [
      {
         id: "source-audio",
         name: "Source audio",
         kind: "source",
         sourceId: "",
         executable: "",
         deviceId: "",
         enabled: true,
         volume: 1,
         muted: false,
         includeInMaster: false,
      },
      {
         id: "other",
         name: "Other app",
         kind: "application",
         sourceId: other!.id,
         executable: other!.executable,
         deviceId: "",
         enabled: true,
         volume: 1,
         muted: false,
         includeInMaster: false,
      },
   ];
   await page.evaluate(
      async ({ sources, sourceId }) => {
         const current = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...current.preferences, sourceKind: "app", sourceId, audioSources: sources });
      },
      { sources: audioSources, sourceId: captureSource!.id }
   );
   expect(await page.evaluate(() => window.acroClip.audioDevices("output"))).toEqual([{ id: "system", name: "System audio" }]);
   await page.getByRole("button", { name: "Start recording", exact: true }).click();
   await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).recorder.state), { timeout: 30000 }).toBe("recording");
   await expect
      .poll(
         async () => {
            const recorder = await page.evaluate(async () => (await window.acroClip.state()).recorder);
            recordingStates.push({ at: Date.now(), ...recorder });
            return recorder.availableSeconds;
         },
         { timeout: 30000 }
      )
      .toBeGreaterThanOrEqual(4.9);
   await page.getByRole("button", { name: "Library", exact: true }).click();
   expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
   await page.evaluate(() => window.acroClip.window("minimize"));
   expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
   await desktop.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      window?.show();
   });
   await page.evaluate(() => window.acroClip.window("close"));
   expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
   await page.evaluate(() => window.acroClip.saveClip());
   await page.waitForTimeout(100);
   await page.evaluate(() => window.acroClip.saveClip());
   await page.evaluate(() => window.acroClip.stopRecording());
   // The watcher can discover the files before save registration attaches their metadata.
   await expect
      .poll(
         () =>
            page.evaluate(async () => {
               const state = await window.acroClip.state();
               return state.clips.length === 2 && state.recorder.pendingSaves === 0;
            }),
         { timeout: 60000 }
      )
      .toBe(true);
   const state = await page.evaluate(() => window.acroClip.state());
   const original = state.clips[0]!;
   expect(original.width).toBe(identity.windowPixels.width);
   expect(original.height).toBe(identity.windowPixels.height);
   expect(original.duration).toBeGreaterThanOrEqual(4.5);
   expect(original.source).toContain("Mac capture fixture");
   const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
   const hash = digest(await readFile(original.path));
   const audioEvidence: Array<{ clip: string; tones: number[][] }> = [];
   for (const clip of state.clips) {
      await run(ffmpeg, ["-v", "error", "-i", clip.path, "-map", "0", "-f", "null", "-"]);
      const { stdout: metadata } = await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", clip.path]);
      const audio = z
         .object({ streams: z.array(z.object({ codec_type: z.string(), tags: z.object({ title: z.string().optional() }).optional() })) })
         .parse(JSON.parse(metadata)).streams;
      expect(audio.filter((stream) => stream.codec_type === "audio").map((stream) => stream.tags?.title)).toEqual(["Master", "Application", "Other app"]);
      for (const track of [0, 1, 2]) {
         const { stderr } = await run(ffmpeg, ["-hide_banner", "-i", clip.path, "-map", `0:a:${track}`, "-af", "volumedetect", "-f", "null", "-"]);
         const mean = stderr.match(/mean_volume: (-?[\d.]+) dB/);
         expect(mean).not.toBeNull();
         expect(Number(mean![1])).toBeGreaterThan(-55);
      }
      const measured = await Promise.all([0, 1, 2].map((track) => tones(clip.path, track)));
      onlyTone(measured[1]!, 0);
      onlyTone(measured[2]!, 1);
      expect(Math.min(...measured[0]!)).toBeGreaterThan(0.03);
      expect(measured[0]![0]! / measured[1]![0]!).toBeGreaterThan(0.8);
      expect(measured[0]![0]! / measured[1]![0]!).toBeLessThan(1.2);
      expect(measured[0]![1]! / measured[2]![1]!).toBeGreaterThan(0.8);
      expect(measured[0]![1]! / measured[2]![1]!).toBeLessThan(1.2);
      audioEvidence.push({ clip: clip.id, tones: measured });
      await verifyFixtureFrames(clip.path);
   }
   const systemAudio: AdditionalAudioSource = {
      id: "system",
      name: "System audio",
      kind: "output",
      sourceId: "",
      executable: "",
      deviceId: "system",
      enabled: true,
      volume: 1,
      muted: false,
      includeInMaster: false,
   };
   await page.evaluate(async (source) => {
      const current = await window.acroClip.state();
      await window.acroClip.savePreferences({ ...current.preferences, audioSources: [source] });
      await window.acroClip.startRecording();
   }, systemAudio);
   await expect
      .poll(() => page.evaluate(async () => (await window.acroClip.state()).recorder.availableSeconds), { timeout: 30000 })
      .toBeGreaterThanOrEqual(4.9);
   await page.evaluate(async () => {
      await window.acroClip.saveClip();
      await window.acroClip.stopRecording();
   });
   await expect
      .poll(
         () =>
            page.evaluate(async () => {
               const state = await window.acroClip.state();
               return state.clips.length === 3 && state.recorder.pendingSaves === 0;
            }),
         { timeout: 60000 }
      )
      .toBe(true);
   const completed = (await page.evaluate(() => window.acroClip.state())).clips;
   const systemClip = completed.find((clip) => !state.clips.some((previous) => previous.id === clip.id))!;
   expect(systemClip.duration).toBeGreaterThanOrEqual(4.5);
   expect(systemClip.width).toBe(identity.windowPixels.width);
   expect(systemClip.height).toBe(identity.windowPixels.height);
   await run(ffmpeg, ["-v", "error", "-i", systemClip.path, "-map", "0", "-f", "null", "-"]);
   const { stdout: systemMetadata } = await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", systemClip.path]);
   const systemStreams = z
      .object({ streams: z.array(z.object({ codec_type: z.string(), tags: z.object({ title: z.string().optional() }).optional() })) })
      .parse(JSON.parse(systemMetadata)).streams;
   expect(systemStreams.filter((stream) => stream.codec_type === "audio").map((stream) => stream.tags?.title)).toEqual(["Master", "System audio"]);
   const systemTones = await Promise.all([0, 1].map((track) => tones(systemClip.path, track)));
   for (const tone of systemTones) expect(Math.min(...tone)).toBeGreaterThan(0.03);
   for (const tone of [0, 1]) {
      expect(systemTones[0]![tone]! / systemTones[1]![tone]!).toBeGreaterThan(0.8);
      expect(systemTones[0]![tone]! / systemTones[1]![tone]!).toBeLessThan(1.2);
   }
   audioEvidence.push({ clip: systemClip.id, tones: systemTones });
   await verifyFixtureFrames(systemClip.path);
   await page.evaluate((id) => window.acroClip.createShareable(id, 1), original.id);
   await expect
      .poll(() => page.evaluate(async (id) => (await window.acroClip.state()).clips.find((clip) => clip.id === id)?.shareables.length, original.id), {
         timeout: 90000,
      })
      .toBe(1);
   expect(digest(await readFile(original.path))).toBe(hash);
   const copy = (await page.evaluate(() => window.acroClip.state())).clips.find((clip) => clip.id === original.id)!.shareables[0]!;
   expect((await stat(copy.path)).size).toBeLessThanOrEqual(1000000);
   await run(ffmpeg, ["-v", "error", "-i", copy.path, "-map", "0", "-f", "null", "-"]);
   await writeFile(
      path.join(evidence, "proof.json"),
      JSON.stringify(
         {
            schema: 1,
            actualPackagedApp: true,
            windowCaptureTested: true,
            hiddenRecordingTested: true,
            repeatedSavesThroughStopTested: true,
            everyDecodedFrameMatchedFixture: true,
            changingFixtureColorsTested: true,
            originalPreserved: true,
            oneMBShareableTested: true,
            fixtureAudioStarted: identity.audioStarted,
            generatedApplicationAudioTested: true,
            selectedApplicationAudioIsolationTested: true,
            systemMixTested: true,
            automaticMasterInclusionTested: true,
            audioEvidence,
            original: { duration: original.duration, width: original.width, height: original.height, source: original.source, sha256: hash },
            shareableBytes: (await stat(copy.path)).size,
            physicalMicrophoneTested: false,
            permissionPromptsTested: false,
         },
         null,
         2
      )
   );
   console.log("Actual packaged macOS application capture, hidden saves, full decoding, and 1 MB sharing passed.");
} catch (error) {
   console.error("Packaged Mac verification failed before cleanup:", error);
   throw error;
} finally {
   await writeFile(`${fixtureOutput}.stop`, "");
   await writeFile(`${decoyOutput}.stop`, "");
   for (const line of (await readFile(fixtureOutput, "utf8").catch(() => "")).split("\n").slice(1)) {
      if (!line) continue;
      try {
         const value = z.object({ event: z.literal("audio-health"), engineRunning: z.boolean(), renderedFrames: z.number() }).safeParse(JSON.parse(line));
         if (value.success) fixtureHealth.push(value.data);
      } catch {
         // A final partial diagnostic line must not block process cleanup.
      }
   }
   await writeFile(path.join(evidence, "fixture.log"), fixtureErrors.join(""));
   await writeFile(path.join(evidence, "application.log"), applicationErrors.join(""));
   await writeFile(path.join(evidence, "recording-states.json"), JSON.stringify(recordingStates, null, 2));
   await writeFile(path.join(evidence, "fixture-health.json"), JSON.stringify(fixtureHealth, null, 2));
   try {
      if (desktop) await closeTestApplication(desktop);
   } finally {
      fixture.kill();
      decoy.kill();
   }
}
