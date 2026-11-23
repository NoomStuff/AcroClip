import type { ElectronApplication } from "@playwright/test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Records the links and files the app opens instead of opening them. Linux opens them with
 * `xdg-open` rather than Electron's shell, so there a stand-in `xdg-open` goes first on PATH.
 * Launch the app with `environment`, then call `stub` once it runs.
 */
export async function externalOpener(profile: string) {
   const bin = join(profile, "opener-bin"),
      log = join(profile, "opened.txt");
   const environment: NodeJS.ProcessEnv = { ...process.env };
   if (process.platform === "linux") {
      await mkdir(bin);
      await writeFile(join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${log}'\n`);
      await chmod(join(bin, "xdg-open"), 0o755);
      environment["PATH"] = `${bin}:${process.env["PATH"] ?? ""}`;
   }
   return {
      environment,
      stub: (app: ElectronApplication) =>
         app.evaluate(({ shell }) => {
            const fixture = globalThis as typeof globalThis & { externalOpened?: string[] };
            fixture.externalOpened = [];
            shell.openExternal = async (url) => void fixture.externalOpened!.push(url);
         }),
      /** Everything opened so far, oldest first. */
      opened: async (app: ElectronApplication): Promise<string[]> => [
         ...(await app.evaluate(() => (globalThis as typeof globalThis & { externalOpened?: string[] }).externalOpened ?? [])),
         ...(await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean),
      ],
   };
}
