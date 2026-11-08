import "./interactive-test-guard";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { CollectionService } from "../src/main/collection";
import { probe, runMedia } from "../src/main/media";

// Two overlapping saves from one real capture session, merged the way the app
// does after the second save lands.
if (process.platform !== "win32") throw new Error("This capture proof requires Windows");
const runtime = path.resolve("resources/recorder");
const folder = path.resolve(".cache/native-merge", randomUUID());
const collection = path.join(folder, "collection");
const trash = path.join(folder, "trash");
await mkdir(collection, { recursive: true });
await mkdir(trash);
interface Event {
   event: string;
   id?: string;
   requestId?: string;
   message?: string;
}
const events: Event[] = [];
const logs: string[] = [];
const child = spawn(path.join(runtime, "acroclip-recorder.exe"), [runtime], { cwd: runtime, stdio: "pipe", windowsHide: true });
child.stderr.on("data", (value: Buffer) => logs.push(value.toString()));
createInterface({ input: child.stdout }).on("line", (value) => events.push(JSON.parse(value) as Event));
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const send = (value: Record<string, unknown>): void => {
   child.stdin.write(`${JSON.stringify(value)}\n`);
};
async function wait(predicate: (value: Event) => boolean): Promise<Event> {
   const deadline = Date.now() + 30_000;
   while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`Recorder exited ${child.exitCode}`);
      await delay(20);
   }
   throw new Error(`Timed out: ${JSON.stringify(events.slice(-5))}`);
}
let statusTimer: ReturnType<typeof setInterval> | undefined;
try {
   await wait((value) => value.event === "ready");
   statusTimer = setInterval(() => {
      if (child.exitCode === null && child.stdin.writable) send({ action: "status" });
   }, 250);
   const saved: string[] = [];
   for (const extension of ["mp4", "mkv"]) {
      send({
         action: "start",
         id: `${extension}-start`,
         allowSoftwareEncoder: process.env["ACROCLIP_NATIVE_TEST_SOFTWARE"] === "1",
         sourceKind: "screen",
         resolvedKind: "screen",
         screenIndex: 0,
         sourceId: "screen:0:0",
         sourceName: "Desktop",
         clipSeconds: 6,
         avoidOverlap: false,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 30,
         customCQ: 23,
         captureAudio: true,
         microphone: false,
         audioSources: [],
         automaticMaster: true,
         sourceAudioPresent: true,
         sourceAudioName: "Desktop",
      });
      assert.equal((await wait((value) => value.id === `${extension}-start`)).event, "response");
      await delay(7500);
      const older = path.join(collection, `Desktop older.${extension}`);
      const newer = path.join(collection, `Desktop newer.${extension}`);
      send({ action: "save", requestId: `${extension}-older`, path: older, requestedAt: Date.now() });
      await delay(3000);
      send({ action: "save", requestId: `${extension}-newer`, path: newer, requestedAt: Date.now() });
      for (const id of [`${extension}-older`, `${extension}-newer`]) {
         const result = await wait((value) => value.requestId === id && ["saved", "error"].includes(value.event));
         assert.equal(result.event, "saved", result.message ?? `${id} failed`);
      }
      send({ action: "stop", id: `${extension}-stop` });
      await wait((value) => value.id === `${extension}-stop`);
      saved.push(older, newer);
   }
   if (statusTimer) clearInterval(statusTimer);
   send({ action: "exit" });
   await new Promise<void>((resolve) => child.once("exit", () => resolve()));
   assert.equal(child.exitCode, 0);

   const service = new CollectionService();
   await service.open(collection);
   for (let index = 0; index < saved.length; index += 2) {
      const [older, newer] = [saved[index]!, saved[index + 1]!];
      const [olderInfo, newerInfo] = [await probe(older), await probe(newer)];
      const olderBytes = await readFile(older);
      const id = (file: string) => service.clips.find((clip) => clip.path === file)!.id;
      const outcome = await service.mergeRecordings(id(older), id(newer), (file) => rename(file, path.join(trash, `${randomUUID()}-${path.basename(file)}`)));
      assert.ok(outcome.merged, `Real overlapping saves merge: ${outcome.merged ? "" : outcome.reason}`);
      const merged = await probe(newer);
      // Saved three seconds apart with six seconds each: about nine seconds of footage.
      assert.ok(merged.duration > newerInfo.duration + 2 && merged.duration < olderInfo.duration + newerInfo.duration - 1, `Merged ${merged.duration} s`);
      assert.deepEqual(
         merged.tracks.map((track) => track.title),
         newerInfo.tracks.map((track) => track.title)
      );
      await runMedia("ffmpeg", ["-v", "error", "-i", newer, "-f", "null", "-"]);
      const trashed = (await readdir(trash)).filter((name) => name.endsWith(path.basename(older)));
      assert.equal(trashed.length, 1);
      assert.deepEqual(await readFile(path.join(trash, trashed[0]!)), olderBytes);
      console.log(
         `${path.extname(newer)}: merged ${olderInfo.duration.toFixed(2)} s and ${newerInfo.duration.toFixed(2)} s into ${merged.duration.toFixed(2)} s`
      );
   }
   console.log(`Real overlapping saves merged losslessly in MP4 and MKV. Proof: ${folder}`);
} finally {
   if (statusTimer) clearInterval(statusTimer);
   if (child.exitCode === null) child.kill();
   await writeFile(path.join(folder, "events.json"), JSON.stringify(events, null, 2));
   await writeFile(path.join(folder, "native.log"), logs.join(""));
}
