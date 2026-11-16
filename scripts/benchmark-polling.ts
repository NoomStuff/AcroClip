import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

// What AcroClip's recurring checks cost on this machine, with the real recorder. Nothing is
// captured or played: the helper starts as the app starts it, idle. Run before and after a
// change on the same machine. Prints one JSON object.
//
//   bun scripts/benchmark-polling.ts [--rounds 40]
if (process.platform !== "win32") throw new Error("The polling benchmark measures the Windows recorder");
const roundsFlag = process.argv.indexOf("--rounds");
const rounds = roundsFlag > 0 ? Math.max(5, Number(process.argv[roundsFlag + 1])) : 40;
const runtime = path.resolve("resources/recorder");
const recorder = path.join(runtime, "acroclip-recorder.exe");
if (!existsSync(recorder)) throw new Error("Build the recorder first with bun run build:native");

type Summary = { medianMs: number; p90Ms: number; maxMs: number; cpuMs: number };
const summary = (times: number[], cpuMs: number): Summary => {
   const sorted = [...times].sort((a, b) => a - b);
   const at = (share: number) => Number(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!.toFixed(2));
   return { medianMs: at(0.5), p90Ms: at(0.9), maxMs: Number(sorted.at(-1)!.toFixed(2)), cpuMs: Number(cpuMs.toFixed(2)) };
};
/** Total CPU a running process has used, from Windows itself. */
const cpuOf = (pid: number) =>
   Number(
      execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds`], { encoding: "utf8" }).trim()
   );

const results: Record<string, unknown> = { rounds };

// 1. Discovery as the app did it on Windows: a new recorder process per listing. PowerShell reads
// each finished process's CPU time, which Node can't.
const spawned = JSON.parse(
   execFileSync(
      "powershell.exe",
      [
         "-NoProfile",
         "-Command",
         `$wall=@();$cpu=@();for($i=0;$i -lt ${rounds};$i++){$s=[Diagnostics.ProcessStartInfo]::new('${recorder}','"${runtime}" --candidates');$s.UseShellExecute=$false;$s.RedirectStandardOutput=$true;$s.CreateNoWindow=$true;$w=[Diagnostics.Stopwatch]::StartNew();$p=[Diagnostics.Process]::Start($s);$null=$p.StandardOutput.ReadToEnd();$p.WaitForExit();$w.Stop();$wall+=$w.Elapsed.TotalMilliseconds;$cpu+=$p.TotalProcessorTime.TotalMilliseconds;$p.Dispose()};@{wall=$wall;cpu=$cpu}|ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 }
   )
) as { wall: number[]; cpu: number[] };
results["discoverySpawn"] = summary(spawned.wall, spawned.cpu.reduce((a, b) => a + b, 0) / spawned.cpu.length);

// 2. The same listing and a status report from the recorder that's already running.
const helper = spawn(recorder, [runtime], { cwd: runtime, windowsHide: true, stdio: "pipe" });
const lines: string[] = [];
const waiting = new Set<(line: string) => boolean>();
createInterface({ input: helper.stdout }).on("line", (line) => {
   lines.push(line);
   for (const check of [...waiting]) if (check(line)) waiting.delete(check);
});
const next = (match: (line: string) => boolean) =>
   new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The recorder didn't answer: ${lines.slice(-4).join("\n")}`)), 15000);
      waiting.add((line) => {
         if (!match(line)) return false;
         clearTimeout(timer);
         resolve();
         return true;
      });
   });
async function inHelper(action: string): Promise<Summary> {
   const times: number[] = [];
   const before = cpuOf(helper.pid!);
   for (let round = 0; round < rounds; round++) {
      const id = randomUUID();
      const start = performance.now();
      const answered = next((line) => line.includes(`"id":"${id}"`));
      helper.stdin.write(`${JSON.stringify({ action, id })}\n`);
      await answered;
      times.push(performance.now() - start);
   }
   return summary(times, (cpuOf(helper.pid!) - before) / rounds);
}
try {
   await next((line) => line.includes('"event":"ready"'));
   results["discoveryInRecorder"] = await inHelper("candidates");
   results["statusInRecorder"] = await inHelper("status");
} finally {
   helper.stdin.write(`${JSON.stringify({ action: "exit" })}\n`);
   await new Promise((resolve) => setTimeout(resolve, 500));
   if (helper.exitCode === null) helper.kill();
}

// 3. Desktop audio rounds, from the native benchmark when the test fixtures are built.
const sessions = path.resolve(".cache/native-tests/Release/acroclip-audio-sessions-bench.exe");
if (existsSync(sessions)) {
   const run = spawnSync(sessions, [String(rounds * 25)], { encoding: "utf8", windowsHide: true });
   if (run.status === 0) results["desktopAudio"] = JSON.parse(run.stdout) as unknown;
   else results["desktopAudio"] = { error: run.stderr.trim() };
}
console.log(JSON.stringify(results, null, 2));

// --check turns the numbers into budgets for CI. Hosted runners differ in speed from run to run, so
// most budgets compare the cheap path with the expensive one it replaced on the same machine.
if (process.argv.includes("--check")) {
   type Micro = { medianUs: number };
   const spawn = results["discoverySpawn"] as Summary;
   const listing = results["discoveryInRecorder"] as Summary;
   const status = results["statusInRecorder"] as Summary;
   const audio = results["desktopAudio"] as Record<string, Micro> | undefined;
   const failures: string[] = [];
   const expectThat = (passed: boolean, message: string) => passed || failures.push(message);
   expectThat(
      listing.medianMs * 5 < spawn.medianMs,
      `Listing apps through the recorder (${listing.medianMs} ms) must stay well under a new process (${spawn.medianMs} ms)`
   );
   expectThat(listing.p90Ms < 20, `Listing apps through the recorder must stay under 20 ms at p90, took ${listing.p90Ms} ms`);
   expectThat(status.medianMs < 5, `A status report must stay under 5 ms, took ${status.medianMs} ms`);
   if (!audio?.["round"] || !audio["oldRound"] || !audio["sessionStartTimes"] || !audio["processSnapshot"])
      failures.push("The desktop audio benchmark didn't run");
   else {
      expectThat(
         // 0.64 of the old round on a hosted runner, 0.15 on a desktop PC with more audio drivers.
         audio["round"].medianUs < audio["oldRound"].medianUs * 0.85,
         `A desktop audio round (${audio["round"].medianUs} us) must stay under 85% of the old one (${audio["oldRound"].medianUs} us)`
      );
      expectThat(
         audio["sessionStartTimes"].medianUs * 20 < audio["processSnapshot"].medianUs,
         `Checking session start times (${audio["sessionStartTimes"].medianUs} us) must stay far under a process snapshot (${audio["processSnapshot"].medianUs} us)`
      );
   }
   if (failures.length) throw new Error(failures.join("\n"));
   console.log("Polling stays within its budgets");
}
