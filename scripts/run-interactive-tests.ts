import { execFileSync, spawnSync } from "node:child_process";
import { z } from "zod";
import { hostedTestIsolation, requireTestIsolation } from "./test-isolation";

const commands = {
   ui: [
      ["run", "build"],
      ["x", "playwright", "test"],
   ],
   "ui-native": [["scripts/test-native-ui.ts"]],
   packaged: [["tests/packaged.ts"]],
   portable: [["scripts/test-portable.ts"]],
   installer: [["installer"]],
   native: [["scripts/smoke-recorder.ts"]],
   lifecycle: [["scripts/smoke-start-lifecycle.ts", "resources/recorder/acroclip-recorder.exe"]],
   "capture-loss": [["scripts/smoke-capture-loss.ts"]],
   fullscreen: [["scripts/smoke-fullscreen.ts"]],
   feedback: [["scripts/smoke-feedback.ts"]],
   audio: [["scripts/smoke-audio.ts"]],
   "audio-monitor": [["scripts/smoke-audio-monitor.ts"]],
   "additional-audio": [["scripts/smoke-additional-audio.ts"]],
   "game-capture": [["scripts/smoke-game-capture.ts"]],
   overlap: [["scripts/smoke-overlap.ts"]],
   "resolution-limits": [["scripts/smoke-resolution-limits.ts"]],
} satisfies Record<string, string[][]>;
const requested = process.argv[2];
if (!requested || !Object.hasOwn(commands, requested)) throw new Error(`Choose an isolated suite: ${Object.keys(commands).join(", ")}`);
const suite = requested as keyof typeof commands;
const testArguments = process.env["ACROCLIP_INTERACTIVE_ARGUMENTS"]
   ? z.array(z.string()).parse(JSON.parse(process.env["ACROCLIP_INTERACTIVE_ARGUMENTS"]))
   : process.argv.slice(3);
const read = (command: string, args: string[]): string => execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
if (!hostedTestIsolation(process.env, process.platform)) {
   const status = read("git", ["status", "--porcelain", "--untracked-files=normal"]);
   if (status)
      throw new Error(
         "Interactive tests did not run. The working tree has local changes. Nothing was staged, committed, pushed or uploaded. Verify those changes in an isolated runner, or commit and push the intended test revision first."
      );
   const commit = read("git", ["rev-parse", "HEAD"]);
   const references = read("git", ["ls-remote", "origin", "refs/heads/*"])
      .split("\n")
      .map((line) => line.split(/\s+/));
   const branch = references.find(([sha, ref]) => sha === commit && ref === "refs/heads/main") ?? references.find(([sha]) => sha === commit);
   if (!branch?.[1]) throw new Error("Interactive tests did not run. This exact commit is not on a remote branch. Nothing was pushed or uploaded.");
   const ref = branch[1].replace(/^refs\/heads\//, "");
   console.log(`Running ${suite} in disposable Windows CI for ${commit} on ${ref}. No local files are transferred.`);
   const dispatched = read("gh", [
      "workflow",
      "run",
      "checks.yml",
      "--ref",
      ref,
      "-f",
      `interactive_suite=${suite}`,
      "-f",
      `expected_commit=${commit}`,
      "-f",
      `interactive_arguments=${JSON.stringify(testArguments)}`,
   ]);
   console.log(dispatched);
   const run = /actions\/runs\/(\d+)/.exec(dispatched)?.[1];
   if (!run) throw new Error("Workflow dispatched, but no run ID was returned. No result has been claimed; inspect the workflow on GitHub.");
   const result = spawnSync("gh", ["run", "watch", run, "--exit-status", "--interval", "30"], { stdio: "inherit", windowsHide: true });
   if (result.error) throw result.error;
   if (result.status !== 0) process.exit(result.status ?? 1);
   if (read("git", ["rev-parse", "HEAD"]) !== commit || read("git", ["status", "--porcelain", "--untracked-files=normal"])) {
      throw new Error(`Remote checks passed for ${commit}; the local working tree changed and is not covered by that result.`);
   }
   console.log(`Isolated ${suite} passed for exact commit ${commit}. No interactive test ran on this desktop.`);
} else {
   requireTestIsolation();
   if (!["ui", "ui-native", "packaged", "portable", "installer"].includes(suite)) {
      for (const args of [
         ["-S", "native/tests", "-B", ".cache/native-tests"],
         ["--build", ".cache/native-tests", "--config", "Release"],
      ]) {
         const fixture = spawnSync("cmake", args, { stdio: "inherit", windowsHide: true });
         if (fixture.error) throw fixture.error;
         if (fixture.status !== 0) process.exit(fixture.status ?? 1);
      }
   }
   for (const [index, args] of commands[suite].entries()) {
      const installer = args[0] === "installer";
      const commandArguments = installer ? ["-File", "scripts/test-installer-upgrade.ps1"] : [...args];
      if (index === commands[suite].length - 1) commandArguments.push(...testArguments);
      const result = spawnSync(installer ? "pwsh" : process.execPath, commandArguments, {
         stdio: "inherit",
         windowsHide: true,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) process.exit(result.status ?? 1);
   }
}
