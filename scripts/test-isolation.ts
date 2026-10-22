import { statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

export function hostedTestIsolation(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
   return (
      environment["GITHUB_ACTIONS"] === "true" &&
      environment["ACROCLIP_ISOLATED_TEST_RUNNER"] === "github-hosted" &&
      (platform !== "win32" || Boolean(environment["ACROCLIP_TEST_RENDER_ENDPOINT_ID"]))
   );
}

export function privateLinuxTestIsolation(environment: NodeJS.ProcessEnv): boolean {
   const runtime = environment["XDG_RUNTIME_DIR"];
   if (environment["ACROCLIP_ISOLATED_TEST_RUNNER"] !== "private-linux" || !runtime) return false;
   const directory = resolve(runtime);
   if (!directory.startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("acroclip-")) return false;
   if (environment["PULSE_SERVER"] !== `unix:${directory}/audio.sock` || !(environment["DISPLAY"] || environment["WAYLAND_DISPLAY"])) return false;
   try {
      const folder = statSync(directory);
      return folder.isDirectory() && (folder.mode & 0o077) === 0 && folder.uid === process.getuid?.() && statSync(resolve(directory, "audio.sock")).isSocket();
   } catch {
      return false;
   }
}

export function requireTestIsolation(): void {
   if (hostedTestIsolation(process.env, process.platform) || (process.platform === "linux" && privateLinuxTestIsolation(process.env))) return;
   throw new Error(
      "Interactive tests did not run. They require a disposable CI desktop with private audio, or the private Linux fixture. Use bun run test:isolated <suite> for an exact committed, pushed revision. Dirty local files are never uploaded. Unit and file-based media tests remain local."
   );
}
