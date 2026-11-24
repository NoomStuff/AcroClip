import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dlopen, ptr } from "bun:ffi";

// Compare the real compiled splash before/after a change. Windows Forms runs on a private
// desktop and launches a dummy child, never the app, so no shortcuts, audio or capture start.
// bun scripts/benchmark-splash.ts --baseline <commit>
if (process.platform !== "win32") throw new Error("The splash benchmark requires Windows");
const { openDesktop, spawnOnDesktop } = await import("./windows-desktop");
const baselineFlag = process.argv.indexOf("--baseline");
if (baselineFlag < 0 || !process.argv[baselineFlag + 1]) throw new Error("Pass --baseline <commit> to compare with the working tree");
const baseline = execFileSync("git", ["rev-parse", "--verify", `${process.argv[baselineFlag + 1]}^{commit}`], { encoding: "utf8", windowsHide: true }).trim();
const root = path.resolve(".cache/splash-benchmark", randomUUID());
await mkdir(root, { recursive: true });
const temporary = path.join(root, "temp");
await mkdir(temporary);
const compiler = ["Framework64", "Framework"]
   .map((folder) => path.join(process.env["SystemRoot"] ?? "C:/Windows", "Microsoft.NET", folder, "v4.0.30319/csc.exe"))
   .find((file) => existsSync(file));
if (!compiler) throw new Error("The .NET Framework C# compiler is missing");
const compile = (output: string, sources: string[], references: string[] = []) =>
   execFileSync(compiler, ["/nologo", "/target:winexe", `/out:${output}`, ...references.map((name) => `/r:${name}`), ...sources], { windowsHide: true });

const childSource = path.join(root, "child.cs");
await writeFile(
   childSource,
   `using System;
using System.IO;
using System.Threading;
internal static class Child {
    private static int Main() {
        Thread.Sleep(250);
        File.WriteAllText(Environment.GetEnvironmentVariable("ACROCLIP_SPLASH_SIGNAL"), "ready");
        File.WriteAllText(Environment.GetEnvironmentVariable("ACROCLIP_BENCH_READY"), "ready");
        Thread.Sleep(20000);
        return 42;
    }
}`
);
for (const version of ["baseline", "working"]) {
   const directory = path.join(root, version);
   await mkdir(directory);
   const source = path.join(directory, "splash.cs");
   await writeFile(
      source,
      version === "baseline"
         ? execFileSync("git", ["show", `${baseline}:scripts/splash/splash.cs`], { windowsHide: true })
         : await readFile("scripts/splash/splash.cs")
   );
   compile(path.join(directory, "AcroClip.exe"), [source, path.resolve("scripts/splash/identity.cs")], ["System.Drawing.dll", "System.Windows.Forms.dll"]);
   compile(path.join(directory, "AcroClip-app.exe"), [childSource]);
}
const kernel = dlopen("kernel32.dll", {
   OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
   GetProcessTimes: { args: ["ptr", "ptr", "ptr", "ptr", "ptr"], returns: "i32" },
   GetExitCodeProcess: { args: ["ptr", "ptr"], returns: "i32" },
   TerminateProcess: { args: ["ptr", "u32"], returns: "i32" },
   CloseHandle: { args: ["ptr"], returns: "i32" },
});
const desktop = `acroclip-splash-${randomUUID()}`;
openDesktop(desktop);
const stillActive = 259;
const results: Array<{ version: string; cpuMsPerSecond: number; exitCode: number }> = [];
for (const [index, version] of ["baseline", "working", "working", "baseline"].entries()) {
   const directory = path.join(root, version);
   const ready = path.join(directory, `ready-${index}`);
   const pid = spawnOnDesktop(desktop, path.join(directory, "AcroClip.exe"), [], directory, {
      ...process.env,
      ACROCLIP_BENCH_READY: ready,
      TEMP: temporary,
      TMP: temporary,
   });
   const handle = kernel.symbols.OpenProcess(0x1001, 0, pid);
   if (!handle) throw new Error("Could not retain the benchmark launcher's process handle");
   try {
      const started = performance.now();
      while (!existsSync(ready) && performance.now() - started < 30000) await delay(50);
      if (!existsSync(ready)) throw new Error("The benchmark child did not start");
      const childStarted = performance.now();
      await delay(1500);
      const cpuMs = () => {
         const times = Array.from({ length: 4 }, () => Buffer.alloc(8));
         if (!kernel.symbols.GetProcessTimes(handle, ptr(times[0]!), ptr(times[1]!), ptr(times[2]!), ptr(times[3]!)))
            throw new Error("Could not read launcher CPU time");
         return Number(times[2]!.readBigUInt64LE() + times[3]!.readBigUInt64LE()) / 10000;
      };
      const before = cpuMs();
      const measured = performance.now();
      await delay(10000);
      const used = cpuMs() - before;
      const elapsed = (performance.now() - measured) / 1000;
      const code = new Uint32Array(1);
      do {
         if (!kernel.symbols.GetExitCodeProcess(handle, ptr(code))) throw new Error("Could not read launcher exit code");
         if (code[0] !== stillActive) break;
         if (performance.now() - childStarted > 30000) throw new Error("The launcher outlived its benchmark child");
         await delay(100);
      } while (code[0] === stillActive);
      if (code[0] !== 42) throw new Error(`The launcher changed the child's exit code to ${code[0]}`);
      const result = { version, cpuMsPerSecond: Number((used / elapsed).toFixed(3)), exitCode: code[0] };
      results.push(result);
      console.log(JSON.stringify(result));
   } finally {
      const remaining = new Uint32Array(1);
      if (kernel.symbols.GetExitCodeProcess(handle, ptr(remaining)) && remaining[0] === stillActive) kernel.symbols.TerminateProcess(handle, 1);
      kernel.symbols.CloseHandle(handle);
   }
}
await writeFile(path.join(root, "results.json"), JSON.stringify({ baseline, results }, null, 2));
console.log(`Saved measurements to ${path.join(root, "results.json")}`);
