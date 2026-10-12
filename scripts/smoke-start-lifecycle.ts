import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

if (process.platform !== "win32") throw new Error("This native lifecycle proof requires Windows");
const sourceRuntime = path.resolve("resources/recorder");
const executable = path.resolve(process.argv[2] ?? ".cache/native-build/Release/attaclip-recorder.exe");
const folder = path.resolve(".cache/start-lifecycle", randomUUID());
await mkdir(folder, { recursive: true });
const runtime = path.join(folder, "runtime");
await cp(sourceRuntime, runtime, { recursive: true });
await copyFile(executable, path.join(runtime, "attaclip-recorder.exe"));
const writerGate = path.join(folder, "writer-ready");
await writeFile(writerGate, "ready");
interface Event {
   event: string;
   id?: string;
   requestId?: string;
   message?: string;
   active?: boolean;
   sources?: number;
   attached?: number;
   width?: number;
   height?: number;
   fps?: number;
   availableSeconds?: number;
   pendingSaves?: number;
   acceptedBeforeFailure?: number;
}
const events: Event[] = [];
const stderr: string[] = [];
const child = spawn(path.join(runtime, "attaclip-recorder.exe"), [runtime], {
   cwd: runtime,
   windowsHide: true,
   stdio: "pipe",
   env: {
      ...process.env,
      PATH: `${runtime};${process.env["PATH"] ?? ""}`,
      ATTACLIP_NATIVE_TEST_LIFECYCLE: "1",
      ATTACLIP_NATIVE_TEST_SOFTWARE: "1",
      ATTACLIP_NATIVE_TEST_WRITER_GATE: writerGate,
   },
});
const exit = new Promise<number | null>((resolve) => child.once("exit", resolve));
child.stderr.on("data", (data: Buffer) => stderr.push(data.toString()));
child.stdin.on("error", (error: Error) => stderr.push(error.message));
child.on("error", (error: Error) => stderr.push(error.message));
createInterface({ input: child.stdout }).on("line", (line) => events.push(JSON.parse(line) as Event));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(predicate: (event: Event) => boolean): Promise<Event> {
   const end = Date.now() + 20_000;
   while (Date.now() < end) {
      const event = events.find(predicate);
      if (event) return event;
      assert.equal(child.exitCode, null, `Helper exited ${child.exitCode}`);
      await delay(20);
   }
   throw new Error(`Native lifecycle command timed out: ${JSON.stringify(events)}`);
}
function send(data: Record<string, unknown>): void {
   child.stdin.write(`${JSON.stringify(data)}\n`);
}
async function command(data: Record<string, unknown>): Promise<Event> {
   const id = randomUUID();
   send({ ...data, id });
   return wait((event) => event.id === id);
}
async function state(): Promise<Event> {
   const result = await command({ action: "test-lifecycle" });
   assert.equal(result.event, "lifecycle");
   return result;
}
const config = {
   action: "start",
   sourceKind: "screen",
   screenIndex: 0,
   sourceName: "Lifecycle retry",
   quality: "custom",
   customWidth: 320,
   customHeight: 180,
   customFPS: 10,
   customCQ: 28,
   clipSeconds: 2,
   captureAudio: false,
   microphone: false,
   allowSoftwareEncoder: true,
};
const proof: Record<string, unknown> = {
   executable,
   helperSHA256: createHash("sha256")
      .update(await readFile(executable))
      .digest("hex"),
   hostOSAudioChanged: false,
   passed: false,
};
try {
   await wait((event) => event.event === "ready");
   const initial = await state();
   proof["initial"] = initial;
   const failures = [
      { name: "missing microphone", changes: { microphone: true, microphoneDevice: "attaclip-missing-device" } },
      { name: "missing hardware encoder", changes: { allowSoftwareEncoder: false } },
      { name: "encoder failure during startup", changes: { testEncoderFailure: true } },
      {
         name: "invalid additional-source gain",
         changes: {
            audioSources: [
               {
                  id: "additional",
                  name: "Lifecycle extra",
                  kind: "output",
                  deviceId: "default",
                  enabled: true,
                  includeInMaster: true,
                  volume: -1,
                  muted: true,
               },
            ],
         },
      },
   ];
   const results: Array<{ name: string; error: string | undefined; state: Event }> = [];
   proof["failures"] = results;
   for (const failure of failures) {
      const offset = events.length;
      const result = await command({ ...config, ...failure.changes });
      assert.equal(result.event, "error");
      const after = await state();
      results.push({ name: failure.name, error: result.message, state: after });
      assert.equal(after.active, false);
      assert.equal(after.attached, initial.attached, `Failed start retained attached sources: ${JSON.stringify(after)}`);
      assert.equal(after.sources, initial.sources, `Failed start retained OBS sources: ${JSON.stringify(after)}`);
      assert.deepEqual([after.width, after.height, after.fps], [initial.width, initial.height, initial.fps]);
      assert(!events.slice(offset).some((event) => event.event === "recording"), "A rejected start must not report recording");
   }
   assert.equal((await command(config)).event, "response");
   const running = await state();
   assert.equal(running.active, true);
   assert(Number(running.sources) > Number(initial.sources));
   assert.equal((await command(config)).event, "error");
   assert.equal((await state()).active, true, "Rejecting a duplicate start must preserve recording");
   await delay(3500);
   const file = path.join(folder, "retry.mkv");
   const requestId = randomUUID();
   assert.equal((await command({ action: "save", path: file, requestId })).event, "response");
   await wait((event) => event.event === "saved" && event.requestId === requestId);
   const decode = spawnSync(path.join("resources/media", "ffmpeg.exe"), ["-v", "error", "-i", file, "-f", "null", "-"], {
      encoding: "utf8",
      windowsHide: true,
   });
   assert.equal(decode.status, 0, decode.stderr);
   assert.equal((await command({ action: "stop" })).event, "response");
   const stopped = await state();
   assert.equal(stopped.sources, initial.sources);
   assert.equal(stopped.attached, initial.attached);
   proof["retryRecordedAndFullyDecoded"] = true;
   proof["duplicateStartPreservedRecording"] = true;
   proof["stopped"] = stopped;
   // Real encoded footage, followed by an injected encoder-failure callback.
   // Hold only the writer so destruction precedes muxing the accepted clip.
   assert.equal((await command({ ...config, customFPS: 1 })).event, "response");
   const historyDeadline = Date.now() + 30_000;
   let available = 0;
   while (available < 1.5 && Date.now() < historyDeadline) {
      const offset = events.length;
      const id = randomUUID();
      send({ action: "status", id });
      await wait((event) => event.event === "response" && event.id === id);
      const status = events.slice(offset).find((event) => event.event === "status");
      available = status?.availableSeconds ?? 0;
      if (available < 1.5) await delay(100);
   }
   assert(available >= 1.5, "Encoder failure must be injected after actual encoded history arrives");
   await rm(writerGate);
   const salvagePath = path.join(folder, "accepted-before-encoder-failure.mkv");
   const salvageId = randomUUID();
   const failureId = randomUUID();
   child.stdin.write(
      `${JSON.stringify({ action: "save", path: salvagePath, requestId: salvageId })}\n${JSON.stringify({ action: "test-encoder-failure", id: failureId })}\n`
   );
   const failure = await wait((event) => event.event === "encoder-failure" && event.id === failureId);
   assert.equal(failure.acceptedBeforeFailure, 1, "The clip must still await its endpoint when failure occurs");
   const statusId = randomUUID();
   send({ action: "status", id: statusId });
   await wait((event) => event.event === "response" && event.id === statusId);
   const released = await state();
   assert.equal(released.active, false);
   assert.equal(released.sources, initial.sources);
   assert.equal(released.attached, initial.attached);
   assert(!events.some((event) => event.event === "saved" && event.requestId === salvageId));
   await writeFile(writerGate, "ready");
   await wait((event) => event.event === "saved" && event.requestId === salvageId);
   const salvageDecode = spawnSync(path.join("resources/media", "ffmpeg.exe"), ["-v", "error", "-i", salvagePath, "-f", "null", "-"], {
      encoding: "utf8",
      windowsHide: true,
   });
   assert.equal(salvageDecode.status, 0, salvageDecode.stderr);
   proof["injectedEncoderFailurePreservedAcceptedMediaAfterSourceDestruction"] = true;
   proof["encoderFailure"] = failure;
   proof["releasedBeforeWriter"] = released;
   send({ action: "exit" });
   assert.equal(await Promise.race([exit, delay(10_000).then(() => "timeout")]), 0);
   proof["passed"] = true;
} catch (error) {
   proof["error"] = error instanceof Error ? error.message : String(error);
   throw error;
} finally {
   await writeFile(writerGate, "ready");
   if (child.exitCode === null) {
      send({ action: "stop" });
      send({ action: "exit" });
      const result = await Promise.race([exit, delay(10_000).then(() => "timeout")]);
      if (result === "timeout") child.kill();
   }
   await writeFile(path.join(folder, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
   await writeFile(path.join(folder, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
   await writeFile(path.join(folder, "native.log"), stderr.join(""));
   console.log(`Actual start lifecycle evidence ${folder}`);
}
