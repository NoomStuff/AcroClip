import "./interactive-test-guard";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") throw new Error("Native UI verification currently requires Windows with a working hardware encoder.");
const withUI = process.argv.includes("--with-ui");
const testArguments = process.argv.slice(2).filter((argument) => argument !== "--with-ui");
function run(args: string[], native: boolean): void {
   const result = spawnSync(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, ACROCLIP_NATIVE_UI: native ? "1" : "" },
   });
   if (result.error) throw result.error;
   if (result.status !== 0) process.exit(result.status ?? 1);
}
// Reproduce the release job's preceding UI work when investigating suite interactions.
if (withUI) {
   run(["run", "build"], false);
   run(["x", "playwright", "test"], false);
}
for (const args of [
   ["run", "build"],
   [
      "x",
      "playwright",
      "test",
      "tests/ui/preview-native.spec.ts",
      "tests/ui/auto-native.spec.ts",
      "tests/ui/audio-native.spec.ts",
      "tests/ui/shortcuts-native.spec.ts",
      "tests/ui/listen-native.spec.ts",
      "tests/ui/resolution-native.spec.ts",
      ...testArguments,
   ],
]) {
   if (args[0] === "x") {
      for (const fixtureArgs of [
         ["-S", "native/tests", "-B", ".cache/native-tests"],
         ["--build", ".cache/native-tests", "--config", "Release"],
      ]) {
         const fixture = spawnSync("cmake", fixtureArgs, { stdio: "inherit", windowsHide: true });
         if (fixture.error) throw fixture.error;
         if (fixture.status !== 0) process.exit(fixture.status ?? 1);
      }
   }
   run(args, true);
}
