import "./interactive-test-guard";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
if (process.platform !== "win32") throw new Error("This monitor proof requires Windows");
const runtime = path.resolve("resources/recorder");
const folder = path.resolve(".cache/native-monitor", randomUUID());
await mkdir(folder, { recursive: true });
const title = `AcroClip monitor fixture ${randomUUID()}`;
const fixture = spawn(path.resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"), [title, "997"], {
   stdio: "ignore",
   env: { ...process.env, ACROCLIP_FIXTURE_LONG: "1" },
});
type Event = {
   event: string;
   receivedAt?: number;
   id?: string;
   message?: string;
   windows?: Array<{ id: string; name: string; pid: number; pixelSize?: { width: number; height: number } }>;
   additional?: Record<string, number>;
   sources?: number;
   attached?: number;
   active?: boolean;
   monitoring?: boolean;
   videoEncoder?: boolean;
   audioEncoders?: number;
   historyPackets?: number;
   width?: number;
   height?: number;
   fps?: number;
   availableSeconds?: number;
   requestId?: string;
   listening?: string;
   listeningPeak?: number;
   listeningOutputActive?: boolean;
};
let extraFixture: ReturnType<typeof spawn> | undefined;
let screenCover: ReturnType<typeof spawn> | undefined;
const events: Event[] = [],
   logs: string[] = [];
const helper = spawn(path.join(runtime, "acroclip-recorder.exe"), [runtime], {
   cwd: runtime,
   windowsHide: true,
   stdio: "pipe",
   env: { ...process.env, ACROCLIP_NATIVE_TEST_LIFECYCLE: "1" },
});
helper.stderr.on("data", (value: Buffer) => logs.push(value.toString()));
createInterface({ input: helper.stdout }).on("line", (line) => events.push({ ...JSON.parse(line), receivedAt: performance.now() } as Event));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate: (event: Event) => boolean, after = 0): Promise<Event> {
   const end = Date.now() + 20000;
   while (Date.now() < end) {
      const result = events.slice(after).find(predicate);
      if (result) return result;
      await delay(30);
   }
   throw new Error(`Native monitor timed out: ${JSON.stringify(events.slice(-8))}`);
}
async function command(action: string, data: Record<string, unknown> = {}) {
   const id = randomUUID();
   helper.stdin.write(`${JSON.stringify({ action, id, ...data })}\n`);
   const result = await wait((event) => event.id === id && ["response", "error"].includes(event.event));
   if (result.event === "error") throw new Error(result.message);
   return id;
}
async function lifecycle() {
   const id = await command("test-lifecycle");
   return events.find((event) => event.event === "lifecycle" && event.id === id)!;
}
try {
   await wait((event) => event.event === "ready");
   let target: { id: string; name: string; pid: number; pixelSize?: { width: number; height: number } } | undefined;
   for (let attempt = 0; attempt < 40 && !target; attempt++) {
      const mark = events.length;
      await command("candidates");
      target = events
         .slice(mark)
         .find((event) => event.event === "candidates")
         ?.windows?.find((item) => item.name === title);
      if (!target) await delay(100);
   }
   assert.ok(target, `The controlled application must be available, fixture exit ${fixture.exitCode}`);
   const baseline = await lifecycle();
   const source = {
      id: "monitor-capture",
      name: title,
      kind: "application",
      sourceId: target.id,
      pid: target.pid,
      volume: 1,
      muted: false,
      includeInMaster: false,
   };
   const start = events.length;
   await command("monitor-audio", { enabled: true, audioSources: [source] });
   await wait((event) => (event.additional?.["monitor-capture"] ?? 0) > 0.2, start);
   const live = await lifecycle();
   assert.equal(live.active, false);
   assert.equal(live.monitoring, true);
   assert.equal(live.videoEncoder, false);
   assert.equal(live.audioEncoders, 0);
   assert.equal(live.historyPackets, 0);
   assert.equal(live.sources, baseline.sources! + 1);
   assert.equal(live.attached, baseline.attached! + 1);
   for (const key of ["width", "height", "fps"] as const) assert.equal(live[key], baseline[key]);
   const timings: Array<{ attackMs: number; releaseMs: number }> = [];
   for (let cycle = 0; cycle < 5; cycle++) {
      let mark = events.length,
         requested = performance.now();
      await command("audio", { source: "monitor-capture", volume: 0, muted: false });
      const quiet = await wait((event) => event.event === "audio-levels" && event.additional?.["monitor-capture"] === 0, mark);
      const releaseMs = quiet.receivedAt! - requested;
      mark = events.length;
      requested = performance.now();
      await command("audio", { source: "monitor-capture", volume: 1, muted: false });
      const signal = await wait((event) => (event.additional?.["monitor-capture"] ?? 0) > 0.2, mark);
      const attackMs = signal.receivedAt! - requested;
      timings.push({ attackMs, releaseMs });
   }
   for (const phase of ["attackMs", "releaseMs"] as const) {
      const sorted = timings.map((timing) => timing[phase]).sort((a, b) => a - b);
      assert.ok(sorted[2]! < 100 && sorted[4]! < 500, `Native meter sustained response regressed: ${JSON.stringify(timings)}`);
   }
   console.log("Controlled tone gain envelope to native meter", JSON.stringify(timings));
   await command("listen-audio", { source: "monitor-capture" });
   assert.equal((await lifecycle()).listening, "monitor-capture", "Application audition is independent of its natural output");
   await command("listen-audio", { source: "" });
   await command("audio", { source: "monitor-capture", volume: 0.5, muted: true });
   await command("monitor-audio", { enabled: false });
   const stopped = await lifecycle();
   assert.equal(stopped.sources, baseline.sources);
   assert.equal(stopped.attached, baseline.attached);
   assert.equal(stopped.monitoring, false);
   await assert.rejects(command("monitor-audio", { enabled: true, audioSources: [{ ...source, pid: target.pid + 1 }] }), /target changed/);
   assert.equal((await lifecycle()).sources, baseline.sources, "Failed monitoring must release every source");
   for (let cycle = 0; cycle < 4; cycle++) {
      await command("monitor-audio", { enabled: true, audioSources: [source] });
      await command("monitor-audio", { enabled: false });
   }
   assert.equal((await lifecycle()).sources, baseline.sources);
   await command("test-listener-source", { desktop: true });
   await assert.rejects(command("listen-audio", { source: "test-listener", deviceId: "missing-output" }), /unavailable/);
   await command("listen-audio", { source: "test-listener", deviceId: "default" });
   await command("status");
   assert.equal((await lifecycle()).listening, "test-listener", "An idle desktop meter must not disable input audition");
   await command("listen-audio", { source: "" });
   await command("monitor-audio", { enabled: false });
   assert.equal((await lifecycle()).listeningOutputActive, false);
   await command("test-listener-source");
   await command("listen-audio", { source: "test-listener", deviceId: "default" });
   await command("test-listener-tone");
   const audible = await lifecycle();
   assert.equal(audible.listening, "test-listener");
   assert.equal(audible.listeningOutputActive, true);
   assert.ok((audible.listeningPeak ?? 0) > 0.005, `The helper's actual render session must contain the controlled tone: ${JSON.stringify(audible)}`);
   await command("audio", { source: "test-listener", volume: 3.98, muted: true });
   await command("test-listener-tone");
   const boosted = await lifecycle();
   assert.ok((boosted.listeningPeak ?? 0) > (audible.listeningPeak ?? 0) * 2, "Typed +12 dB must reach audible output while leaving record mute unchanged");
   await command("listen-audio", { source: "" });
   const quiet = await lifecycle();
   assert.equal(quiet.listeningOutputActive, false, "Stopping listen must release its output session");
   await command("listen-audio", { source: "test-listener", deviceId: "default" });
   await command("monitor-audio", { enabled: false });
   assert.equal((await lifecycle()).listening, "");
   console.log(
      "Actual per-source WASAPI listening, boost, mute independence, duplicate prevention, failed output and teardown passed",
      JSON.stringify({ audible, boosted, quiet })
   );
   await command("monitor-audio", { enabled: true, audioSources: [source] });
   await command("start", {
      sourceKind: "auto",
      resolvedKind: "app",
      sourceId: target.id,
      sourceName: title,
      pid: target.pid,
      clipSeconds: 2,
      quality: "custom",
      customWidth: 640,
      customHeight: 360,
      customFPS: 30,
      customCQ: 23,
      captureAudio: true,
      microphone: false,
      audioSources: [],
   });
   await command("monitor-audio", { enabled: false });
   const recording = await lifecycle();
   assert.equal(recording.active, true, "Stale monitor teardown must leave recording running");
   assert.equal(recording.monitoring, false, "Recording must release idle monitor sources");
   for (let attempt = 0; attempt < 60; attempt++) {
      const mark = events.length;
      await command("status");
      if ((events.slice(mark).find((event) => event.event === "status")?.availableSeconds ?? 0) >= 2) break;
      await delay(200);
   }
   // A distinct 1733 Hz test source stays record-muted while monitoring plays it.
   await command("test-listener-source");
   await command("listen-audio", { source: "test-listener", deviceId: "default" });
   for (let cycle = 0; cycle < 6; cycle++) await command("test-listener-tone");
   const recordingListen = await lifecycle();
   assert.equal(recordingListen.active, true);
   assert.equal(recordingListen.listening, "test-listener");
   assert.ok((recordingListen.listeningPeak ?? 0) > 0.005, "Listening must actually play while recording");
   const file = path.join(folder, "monitor-to-recording.mkv");
   await command("save", { requestId: "monitor-transition", requestedAt: Date.now(), path: file });
   await wait((event) => event.event === "saved" && event.requestId === "monitor-transition");
   const decode = spawnSync(path.resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", file, "-f", "null", "-"], {
      windowsHide: true,
      encoding: "utf8",
   });
   assert.equal(decode.status, 0, decode.stderr);
   const measured = spawnSync(
      path.resolve("resources/media/ffmpeg.exe"),
      ["-hide_banner", "-i", file, "-map", "0:a:1", "-af", "volumedetect", "-f", "null", "-"],
      { windowsHide: true, encoding: "utf8" }
   );
   assert.equal(measured.status, 0, measured.stderr);
   assert.ok(Number(/mean_volume: (-?[\d.]+) dB/.exec(measured.stderr)?.[1]) > -65, "The saved capture track must contain the fixture tone");
   const bandVolume = (frequency: number) => {
      const result = spawnSync(
         path.resolve("resources/media/ffmpeg.exe"),
         [
            "-hide_banner",
            "-i",
            file,
            "-map",
            "0:a:0",
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
   const recordedTone = bandVolume(997),
      monitorLeak = bandVolume(1733);
   assert.ok(recordedTone > -65, `Recorded fixture tone missing: ${recordedTone}`);
   assert.ok(monitorLeak < recordedTone - 35, `Listening leaked into the recorded mix: ${JSON.stringify({ recordedTone, monitorLeak })}`);
   await command("listen-audio", { source: "" });
   assert.equal((await lifecycle()).active, true, "Stopping listening must not stop recording");
   await command("listen-audio", { source: "capture" });
   assert.equal((await lifecycle()).active, true, "Application audition must leave recording running");
   await command("listen-audio", { source: "" });
   console.log("Live recording listening keeps record mute and mix unchanged", JSON.stringify({ recordingListen, recordedTone, monitorLeak }));
   await command("listen-audio", { source: "test-listener", deviceId: "default" });
   await command("source", { sourceKind: "auto", resolvedKind: "app", sourceId: target.id, sourceName: title, pid: target.pid, captureAudio: true });
   const switched = await lifecycle();
   assert.equal(switched.active, true, "Changing capture must keep recording active");
   assert.equal(switched.listening, "", "Changing capture must release listening before changing audio routes");
   await command("stop");
   assert.equal((await lifecycle()).sources, baseline.sources);

   // Start Auto before a game is selected. Its first real source establishes
   // encoder dimensions before any history or accepted save can be lost.
   await command("start", {
      sourceKind: "auto",
      resolvedKind: "waiting",
      quality: "high",
      recordingPresetVersion: 1,
      recordingSizeVersion: 2,
      resolutionLimit: 1440,
      customWidth: 2560,
      customHeight: 1440,
      customFPS: 60,
      customCQ: 18,
      clipSeconds: 8,
      captureAudio: true,
      microphone: false,
      audioSources: [],
   });
   await command("source", {
      sourceKind: "auto",
      resolvedKind: "app",
      quality: "high",
      recordingPresetVersion: 1,
      recordingSizeVersion: 2,
      resolutionLimit: 1440,
      customWidth: 2560,
      customHeight: 1440,
      customFPS: 60,
      customCQ: 18,
      sourceId: target.id,
      sourceName: title,
      pid: target.pid,
      captureAudio: true,
   });
   for (let attempt = 0; attempt < 60; attempt++) {
      const mark = events.length;
      await command("status");
      if ((events.slice(mark).find((event) => event.event === "status")?.availableSeconds ?? 0) > 1) break;
      await delay(100);
   }
   const capped = await lifecycle();
   assert.ok(target.pixelSize, "Native candidates must report actual source pixels");
   assert.equal(capped.width, Math.floor(target.pixelSize.width / 2) * 2);
   assert.equal(capped.height, Math.floor(target.pixelSize.height / 2) * 2);
   assert.equal(capped.fps, 60);
   await delay(1800);
   await command("audio", { source: "capture", volume: 1, muted: true });
   await delay(1600);
   await command("audio", { source: "capture", volume: 1, muted: false });
   await delay(1600);
   const cappedFile = path.join(folder, "preset-cap-mute-unmute.mkv");
   await command("save", { requestId: "preset-cap", requestedAt: Date.now(), path: cappedFile });
   const cappedResult = await wait((event) => ["saved", "error"].includes(event.event) && event.requestId === "preset-cap");
   assert.equal(cappedResult.event, "saved", cappedResult.message ?? "");
   const probe = spawnSync(path.resolve("resources/media/ffprobe.exe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", cappedFile], {
      windowsHide: true,
      encoding: "utf8",
   });
   assert.equal(probe.status, 0, probe.stderr);
   const metadata = JSON.parse(probe.stdout) as {
      streams: Array<{ codec_type: string; width: number; height: number; avg_frame_rate: string; start_time: string }>;
      format: { duration: string };
   };
   const video = metadata.streams.find((stream) => stream.codec_type === "video")!;
   assert.equal(video.width, capped.width);
   assert.equal(video.height, capped.height);
   assert.equal(video.avg_frame_rate, "60/1");
   const duration = Number(metadata.format.duration);
   const volumeAt = (start: number, end: number) => {
      const result = spawnSync(
         path.resolve("resources/media/ffmpeg.exe"),
         ["-hide_banner", "-i", cappedFile, "-map", "0:a:1", "-af", `atrim=start=${start}:end=${end},volumedetect`, "-f", "null", "-"],
         { windowsHide: true, encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(result.stderr)?.[1]);
   };
   const initialTone = volumeAt(0.5, 1),
      mutedTone = volumeAt(duration - 2.8, duration - 2.3),
      restoredTone = volumeAt(duration - 0.8, duration - 0.3);
   assert.ok(initialTone > -60 && restoredTone > -60, JSON.stringify({ initialTone, restoredTone }));
   assert.ok(mutedTone < -80, `Mute must silence the allocated track: ${mutedTone}`);
   const decoded = spawnSync(path.resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", cappedFile, "-f", "null", "-"], {
      windowsHide: true,
      encoding: "utf8",
   });
   assert.equal(decoded.status, 0, decoded.stderr);
   const color = spawnSync(
      path.resolve("resources/media/ffmpeg.exe"),
      ["-v", "error", "-ss", "1", "-i", cappedFile, "-frames:v", "1", "-vf", "crop=2:2:iw/2:ih/2,format=rgb24", "-f", "rawvideo", "-"],
      { windowsHide: true }
   );
   assert.equal(color.status, 0);
   assert.ok(color.stdout[0]! < 50 && color.stdout[2]! > 160, `Controlled D3D colors changed: ${[...color.stdout]}`);
   console.log(
      "Preset source cap, actual pixels/fps/colors, stable audio track mute/unmute",
      JSON.stringify({ capped, video, initialTone, mutedTone, restoredTone })
   );
   const handle = BigInt(target.id.split(":")[1]!);
   const resizeScript = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FixtureWindow { [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags); }'; if (-not [FixtureWindow]::SetWindowPos([IntPtr]::new(${handle}), [IntPtr]::Zero, 0, 0, 340, 240, 22)) { exit 1 }`;
   const resized = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(resizeScript, "utf16le").toString("base64")], {
      windowsHide: true,
   });
   assert.equal(resized.status, 0, resized.stderr.toString());
   await assert.rejects(
      command("source", {
         sourceKind: "auto",
         resolvedKind: "app",
         sourceId: target.id,
         sourceName: title,
         pid: target.pid,
         quality: "high",
         recordingPresetVersion: 1,
         recordingSizeVersion: 2,
         resolutionLimit: 1440,
         customWidth: 2560,
         customHeight: 1440,
      }),
      /resolution changed/
   );
   const pausedPreset = await lifecycle();
   assert.equal(pausedPreset.active, true);
   assert.equal(pausedPreset.width, capped.width);
   assert.equal(pausedPreset.height, capped.height);
   assert.ok(pausedPreset.historyPackets! > 0, "A smaller source must preserve recent footage");
   const preservedFile = path.join(folder, "preset-smaller-source-history.mkv");
   await command("save", { requestId: "preset-smaller-source", requestedAt: Date.now(), path: preservedFile });
   const preserved = await wait((event) => ["saved", "error"].includes(event.event) && event.requestId === "preset-smaller-source");
   assert.equal(preserved.event, "saved", preserved.message ?? "");
   const preservedDecode = spawnSync(path.resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", preservedFile, "-f", "null", "-"], {
      windowsHide: true,
      encoding: "utf8",
   });
   assert.equal(preservedDecode.status, 0, preservedDecode.stderr);
   console.log("Smaller preset source pauses and retains a decodable history save", JSON.stringify(pausedPreset));
   await command("stop");
   await assert.rejects(
      command("start", { sourceKind: "app", sourceId: "window:0:0", quality: "high", captureAudio: false, microphone: false }),
      /pixel dimensions are unavailable/
   );
   assert.equal((await lifecycle()).sources, baseline.sources, "Unknown preset source failure must release all sources");

   const extraTitle = `Extra audio fixture ${randomUUID()}`;
   extraFixture = spawn(path.resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"), [extraTitle, "1337"], {
      stdio: "ignore",
      env: { ...process.env, ACROCLIP_FIXTURE_LONG: "1" },
   });
   let extraTarget: { id: string; pid: number } | undefined;
   for (let attempt = 0; attempt < 50 && !extraTarget; attempt++) {
      const mark = events.length;
      await command("candidates");
      extraTarget = events
         .slice(mark)
         .find((event) => event.event === "candidates")
         ?.windows?.find((item) => item.name === extraTitle);
      if (!extraTarget) await delay(100);
   }
   assert.ok(extraTarget, "The distinct-tone application must be available");
   await command("start", {
      sourceKind: "auto",
      resolvedKind: "app",
      sourceId: target.id,
      sourceName: title,
      pid: target.pid,
      quality: "custom",
      customWidth: 640,
      customHeight: 360,
      customFPS: 30,
      customCQ: 23,
      clipSeconds: 3,
      captureAudio: true,
      microphone: false,
      audioSources: [
         {
            id: "extra-fixture",
            name: extraTitle,
            kind: "application",
            sourceId: extraTarget.id,
            pid: extraTarget.pid,
            volume: 1,
            muted: false,
            enabled: true,
            includeInMaster: false,
         },
      ],
   });
   for (let attempt = 0; attempt < 70; attempt++) {
      const mark = events.length;
      await command("status");
      if ((events.slice(mark).find((event) => event.event === "status")?.availableSeconds ?? 0) > 2) break;
      await delay(100);
   }
   const isolatedFile = path.join(folder, "distinct-source-tracks.mkv");
   await command("save", { requestId: "distinct-tracks", requestedAt: Date.now(), path: isolatedFile });
   const isolatedResult = await wait((event) => ["saved", "error"].includes(event.event) && event.requestId === "distinct-tracks");
   assert.equal(isolatedResult.event, "saved", isolatedResult.message ?? "");
   const toneAt = (track: number, frequency: number, file = isolatedFile) => {
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
   const masterMain = toneAt(0, 997),
      masterExtra = toneAt(0, 1337),
      isolatedMain = toneAt(2, 997),
      isolatedExtra = toneAt(2, 1337);
   assert.ok(masterMain > -60 && isolatedExtra > -60, JSON.stringify({ masterMain, isolatedExtra }));
   assert.ok(masterExtra < masterMain - 35 && isolatedMain < isolatedExtra - 35, JSON.stringify({ masterMain, masterExtra, isolatedMain, isolatedExtra }));
   console.log("Additional sources stay isolated without duplicate master content", JSON.stringify({ masterMain, masterExtra, isolatedMain, isolatedExtra }));
   await command("stop");
   const microphone = { id: "test-listener", name: "Microphone", kind: "input", deviceId: "test-tone", enabled: true, volume: 1, muted: false };
   const otherApp = { ...source, id: "extra-game", name: extraTitle, sourceId: extraTarget.id, pid: extraTarget.pid, enabled: true };
   const routingConfig = {
      sourceKind: "auto",
      resolvedKind: "app",
      sourceId: target.id,
      sourceName: title,
      pid: target.pid,
      recordingSizeVersion: 2,
      resolutionLimit: 1440,
      quality: "custom",
      customFPS: 30,
      customCQ: 23,
      clipSeconds: 2,
      captureAudio: true,
      microphone: false,
      automaticMaster: true,
      sourceAudioPresent: true,
      sourceAudioName: "Source audio",
      audioSources: [microphone, otherApp],
   };
   const saveProof = async (name: string) => {
      const file = path.join(folder, `${name}.mkv`);
      await command("save", { requestId: name, requestedAt: Date.now(), path: file });
      const result = await wait((event) => ["saved", "error"].includes(event.event) && event.requestId === name);
      assert.equal(result.event, "saved", result.message ?? "");
      return file;
   };
   const waitForFootage = async () => {
      for (let count = 0; count < 100; count++) {
         const mark = events.length;
         await command("status");
         if ((events.slice(mark).find((event) => event.event === "status")?.availableSeconds ?? 0) > 1.3) return;
         await delay(100);
      }
      throw new Error("Automatic routing never received video");
   };
   await command("start", routingConfig);
   await waitForFootage();
   await command("test-listener-tone");
   const appMix = await saveProof("automatic-app-master");
   const appTones = {
      source: toneAt(0, 997, appMix),
      extra: toneAt(0, 1337, appMix),
      microphone: toneAt(0, 1733, appMix),
      extraIsolated: toneAt(3, 1337, appMix),
      micIsolated: toneAt(2, 1733, appMix),
      isolatedLeak: toneAt(3, 997, appMix),
   };
   assert.ok(appTones.source > -60 && appTones.extra > -60 && appTones.microphone > -65, JSON.stringify(appTones));
   assert.ok(
      Math.abs(appTones.extra - appTones.extraIsolated) < 1.5 && Math.abs(appTones.microphone - appTones.micIsolated) < 1.5 && appTones.isolatedLeak < -70,
      JSON.stringify(appTones)
   );
   await command("listen-audio", { source: "test-listener" });
   await command("audio", { source: "test-listener", volume: 1, muted: true });
   await delay(2400);
   await command("test-listener-tone");
   const audition = await lifecycle();
   assert.equal(audition.listening, "test-listener");
   assert.ok(audition.listeningPeak! > 0.005);
   const appMuted = await saveProof("automatic-app-mic-muted-listening");
   assert.ok(
      toneAt(0, 1733, appMuted) < -70 && toneAt(2, 1733, appMuted) < -70,
      "Record mute remains silent in master and isolated track while audition is audible"
   );
   await command("listen-audio", { source: "" });
   await command("audio", { source: "test-listener", volume: 1, muted: false });
   await delay(2300);
   await command("test-listener-tone");
   const appRestored = await saveProof("automatic-app-mic-restored");
   assert.ok(toneAt(0, 1733, appRestored) > -65 && toneAt(2, 1733, appRestored) > -65);
   await command("stop");
   const coverScript =
      "Add-Type -AssemblyName System.Windows.Forms; $form=New-Object System.Windows.Forms.Form; $form.FormBorderStyle='None'; $form.Bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $form.BackColor=[System.Drawing.Color]::FromArgb(34,85,170); $form.TopMost=$true; [System.Windows.Forms.Application]::Run($form)";
   screenCover = spawn("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(coverScript, "utf16le").toString("base64")], {
      stdio: "ignore",
      windowsHide: true,
   });
   await delay(1800);
   await command("start", { ...routingConfig, sourceKind: "screen", screenIndex: 0, resolutionLimit: 720, sourceName: "Controlled screen" });
   await waitForFootage();
   await command("test-listener-tone");
   const screenMix = await saveProof("automatic-screen-master");
   const screenTones = {
      masterExtra: toneAt(0, 1337, screenMix),
      sourceExtra: toneAt(1, 1337, screenMix),
      isolatedExtra: toneAt(3, 1337, screenMix),
      masterMic: toneAt(0, 1733, screenMix),
      sourceMic: toneAt(1, 1733, screenMix),
      isolatedMic: toneAt(2, 1733, screenMix),
   };
   assert.ok(
      screenTones.masterExtra > -60 && Math.abs(screenTones.masterExtra - screenTones.sourceExtra) < 1.5,
      `Desktop master must not double added app audio: ${JSON.stringify(screenTones)}`
   );
   assert.ok(
      screenTones.masterMic > -65 && screenTones.sourceMic < -70 && Math.abs(screenTones.masterMic - screenTones.isolatedMic) < 1.5,
      JSON.stringify(screenTones)
   );
   await assert.rejects(command("listen-audio", { source: "test-listener" }), /recorded|captured|feedback/);
   await command("stop");
   screenCover.kill();
   screenCover = undefined;
   await assert.rejects(command("start", { ...routingConfig, audioSources: [{ ...otherApp, sourceId: target.id, pid: target.pid }] }), /already included/);
   assert.equal((await lifecycle()).sources, baseline.sources);
   await assert.rejects(
      command("start", {
         ...routingConfig,
         sourceKind: "screen",
         screenIndex: 0,
         audioSources: [{ id: "duplicate-output", name: "Same output", kind: "output", deviceId: "default", enabled: true }],
      }),
      /already included/
   );
   assert.equal((await lifecycle()).sources, baseline.sources);
   console.log(
      "Automatic APP all-source master, SCREEN source-plus-input master, isolated tracks, audible muted audition, restore and duplicate failures passed",
      JSON.stringify({ appTones, screenTones })
   );
   await writeFile(path.join(folder, "proof.json"), JSON.stringify({ baseline, live, stopped, timings, events }, null, 2));
   console.log(`Idle native audio, no video/encoder/history, mute/gain, invalid identity and repeated cleanup passed: ${folder}`);
} finally {
   fixture.kill();
   extraFixture?.kill();
   screenCover?.kill();
   helper.stdin.write(`${JSON.stringify({ action: "exit" })}\n`);
   await Promise.race([new Promise((resolve) => helper.once("exit", resolve)), delay(5000)]);
   if (helper.exitCode === null) helper.kill();
   await writeFile(path.join(folder, "native.log"), logs.join(""));
   await writeFile(path.join(folder, "events.json"), JSON.stringify(events, null, 2));
}
