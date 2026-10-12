import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, link, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "./recorder";
import { defaultPreferences } from "../shared/defaults";
import type { RecorderState } from "../shared/types";

const roots: string[] = [];
const children: Array<Pick<Recorder, "close">> = [];
afterEach(async () => {
   for (const child of children.splice(0)) await child.close({ cancel: true });
   for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(mode: "crash" | "pending" | "normal" | "fatal", invalidExecutable = false) {
   const root = await mkdtemp(join(tmpdir(), "attaclip-protocol-exit-"));
   roots.push(root);
   const executable = join(root, process.platform === "win32" ? "node.exe" : "node");
   if (invalidExecutable) await mkdir(executable);
   else await link(process.execPath, executable).catch(() => copyFile(process.execPath, executable));
   await writeFile(
      join(root, "index.js"),
      `
const readline = require('node:readline');
const emit = x => process.stdout.write(JSON.stringify(x)+'\\n');
const mode = ${JSON.stringify(mode)};
let active = false;
emit({event:'ready',encoders:[]});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const v = JSON.parse(line);
 if(v.action==='windows') emit({event:'windows',windows:[]});
 if(v.action==='start') {
  active=true; emit({event:'recording'});
  if(mode==='crash') setTimeout(()=>process.exit(17),80);
  if(mode==='fatal') setTimeout(()=>{emit({event:'fatal',message:'Video driver stopped responding'});setTimeout(()=>process.exit(17),30)},30);
 }
 if(v.action==='status') emit({event:'status',active,availableSeconds:active?10:0});
 if(v.action==='stop') {active=false;emit({event:'stopped'});}
 if(v.action==='save' && mode==='pending') setTimeout(()=>process.exit(19),80);
 if(v.action==='exit') process.exit(0);
 if(v.id) emit({event:'response',id:v.id});
});`
   );
   const states: RecorderState[] = [];
   const errors: string[] = [];
   const Constructor = Recorder;
   const child = new Constructor({
      nativePath: executable,
      gameCatalogPath: join(root, "catalog.json"),
      onState: (state) => states.push(state),
      onError: (message) => errors.push(message),
      onSaved: () => undefined,
   });
   // The fixture speaks only the helper protocol. It never simulates a valid media file.
   children.push(child);
   const start = () =>
      child.start({ ...defaultPreferences, collection: root, captureAudio: false }, [
         { id: "screen:0:0", kind: "screen", name: "Isolated fixture", thumbnail: "" },
      ]);
   if (!invalidExecutable) await start();
   return { child, states, errors, root, executable, start };
}

describe("recorder helper termination", () => {
   it.each([false, true])("releases an actual failed launch, allows close with cancel=%s, and retries after repair", async (cancel) => {
      const { child, errors, executable, start } = await fixture("normal", true);
      await expect(start()).rejects.toThrow(/spawn/);
      expect(child.status).toMatchObject({ state: "error", pendingSaves: 0 });
      expect(errors).toHaveLength(1);
      await child.close({ cancel });
      await rm(executable, { recursive: true });
      await link(process.execPath, executable).catch(() => copyFile(process.execPath, executable));
      await start();
      expect(child.status.state).toBe("recording");
      await child.close();
      expect(child.status.state).toBe("stopped");
      expect(errors).toHaveLength(1);
   });
   it("keeps unexpected termination visible after its notification", async () => {
      const { child, errors } = await fixture("crash");
      await expect.poll(() => child.status.state).toBe("error");
      expect(errors).toEqual(["Recording stopped unexpectedly with exit code 17"]);
      expect(child.status).toMatchObject({ message: errors[0], availableSeconds: 0, startedAt: null, pendingSaves: 0 });
   });
   it("reports lost pending footage even if capture was deliberately stopped first", async () => {
      const { child, errors, root } = await fixture("pending");
      await child.save(join(root, "unsaved.mkv"));
      await child.stop();
      await child.close();
      expect(errors).toEqual(["Recording stopped unexpectedly with exit code 19"]);
      expect(child.status).toMatchObject({ state: "error", pendingSaves: 0 });
   });
   it("retains a more useful native fatal reason after the helper exits", async () => {
      const { child, errors } = await fixture("fatal");
      await expect.poll(() => child.status.availableSeconds === 0 && child.status.startedAt === null).toBe(true);
      expect(child.status).toMatchObject({ state: "error", message: "Video driver stopped responding" });
      expect(errors).toEqual(["Video driver stopped responding"]);
   });
   it("does not warn for a clean exit or informed cancellation", async () => {
      const clean = await fixture("normal");
      await clean.child.close();
      expect(clean.child.status.state).toBe("stopped");
      expect(clean.errors).toEqual([]);
      const cancelled = await fixture("normal");
      await cancelled.child.save(join(cancelled.root, "discarded.mkv"));
      await cancelled.child.close({ cancel: true });
      expect(cancelled.child.status).toMatchObject({ state: "stopped", pendingSaves: 0, message: "" });
      expect(cancelled.errors).toEqual([]);
   });
});
