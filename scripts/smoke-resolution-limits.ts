import "./interactive-test-guard";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fitResolutionLimit } from "../src/shared/recording-presets";
const runtime = path.resolve("resources/recorder"),
   folder = path.resolve(".cache/resolution-proof", randomUUID());
await mkdir(folder, { recursive: true });
type NativeEvent = {
   event: string;
   id?: string;
   message?: string;
   requestId?: string;
   availableSeconds?: number;
   width?: number;
   height?: number;
   historyPackets?: number;
   windows?: Array<{ id: string; name: string; pid: number }>;
};
const events: NativeEvent[] = [],
   logs: string[] = [];
const helper = spawn(path.join(runtime, "acroclip-recorder.exe"), [runtime], {
   cwd: runtime,
   windowsHide: true,
   stdio: "pipe",
   env: { ...process.env, ACROCLIP_NATIVE_TEST_LIFECYCLE: "1" },
});
helper.stderr.on("data", (value) => logs.push(String(value)));
createInterface({ input: helper.stdout }).on("line", (line) => events.push(JSON.parse(line) as NativeEvent));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate: (event: NativeEvent) => boolean, after = 0) {
   const end = Date.now() + 25000;
   while (Date.now() < end) {
      const result = events.slice(after).find(predicate);
      if (result) return result;
      await delay(50);
   }
   throw new Error(JSON.stringify(events.slice(-6)));
}
async function command(action: string, data: Record<string, unknown> = {}) {
   const id = randomUUID();
   helper.stdin.write(`${JSON.stringify({ action, id, ...data })}\n`);
   const result = await wait((event) => event.id === id && ["response", "error"].includes(event.event));
   if (result.event === "error") throw new Error(result.message);
   return id;
}
async function ready() {
   for (let attempt = 0; attempt < 100; attempt++) {
      const mark = events.length;
      await command("status");
      if ((events.slice(mark).find((event) => event.event === "status")?.availableSeconds ?? 0) > 1.3) return;
      await delay(100);
   }
   throw new Error("Capture never became ready");
}
async function save(name: string) {
   const file = path.join(folder, `${name}.mkv`);
   await command("save", { requestId: name, requestedAt: Date.now(), path: file });
   const result = await wait((event) => event.requestId === name && ["saved", "error"].includes(event.event));
   assert.equal(result.event, "saved", result.message ?? "");
   const metadata = spawnSync(path.resolve("resources/media/ffprobe.exe"), ["-v", "error", "-show_streams", "-of", "json", file], {
      encoding: "utf8",
      windowsHide: true,
   });
   assert.equal(metadata.status, 0, metadata.stderr);
   const video = (JSON.parse(metadata.stdout) as { streams: Array<{ codec_type: string; width: number; height: number }> }).streams.find(
      (stream) => stream.codec_type === "video"
   )!;
   const decode = spawnSync(path.resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", file, "-f", "null", "-"], {
      encoding: "utf8",
      windowsHide: true,
   });
   assert.equal(decode.status, 0, decode.stderr);
   return { width: video.width, height: video.height };
}
let fixture: ReturnType<typeof spawn> | undefined;
const proof: unknown[] = [];
try {
   await wait((event) => event.event === "ready");
   for (const [name, width, height] of [
      ["ultrawide", 2560, 1080],
      ["portrait", 720, 1280],
      ["small", 641, 361],
   ] as const) {
      const title = `AcroClip size ${name} ${randomUUID()}`;
      fixture = spawn(path.resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"), [title], {
         stdio: "ignore",
         env: { ...process.env, ACROCLIP_FIXTURE_LONG: "1", ACROCLIP_FIXTURE_WIDTH: String(width), ACROCLIP_FIXTURE_HEIGHT: String(height) },
      });
      let target: NonNullable<NativeEvent["windows"]>[number] | undefined;
      for (let attempt = 0; attempt < 50 && !target; attempt++) {
         const mark = events.length;
         await command("candidates");
         target = events
            .slice(mark)
            .find((event) => event.event === "candidates")
            ?.windows?.find((item) => item.name === title);
         if (!target) await delay(100);
      }
      assert.ok(target);
      await command("start", {
         sourceKind: "app",
         sourceId: target.id,
         sourceName: title,
         pid: target.pid,
         recordingSizeVersion: 2,
         resolutionLimit: 64,
         quality: "custom",
         customFPS: 30,
         customCQ: 23,
         clipSeconds: 2,
         captureAudio: false,
         microphone: false,
      });
      await ready();
      const actual = await save(name);
      assert.deepEqual(actual, fitResolutionLimit({ width, height }, 64, true));
      proof.push({ name, actual, limit: 64 });
      await command("stop");
      fixture.kill();
      fixture = undefined;
   }
   // Screen capture is covered by the isolated fullscreen color fixture in UI.
   // These native C++ geometry checks also exercise orientation without changing OS displays.
   await writeFile(path.join(folder, "proof.json"), JSON.stringify(proof, null, 2));
   console.log("Real application media keeps original pixels despite screen limit", JSON.stringify(proof), folder);
} finally {
   fixture?.kill();
   helper.stdin.write(`${JSON.stringify({ action: "exit" })}\n`);
   await Promise.race([new Promise((resolve) => helper.once("exit", resolve)), delay(5000)]);
   if (helper.exitCode === null) helper.kill();
   await writeFile(path.join(folder, "native.log"), logs.join(""));
}
