import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { attaCutEnvironment, findAttaCut, rememberAttaCut } from "./attacut";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

describe("AttaCut launch environment", () => {
   it("does not pass the development renderer or runtime overrides into the external app", async () => {
      const inherited: NodeJS.ProcessEnv = {
         ...process.env,
         ELECTRON_RENDERER_URL: "http://localhost:5173",
         ELECTRON_EXEC_PATH: "acroclip-dev.exe",
         ELECTRON_RUN_AS_NODE: "1",
         NODE_OPTIONS: "--not-a-real-node-option",
         NODE_ENV: "development",
         NODE_PATH: "acroclip-modules",
         ACROCLIP_PROFILE: "acroclip-preview",
         ACROCLIP_COLLECTION: "preview-clips",
         ACROCLIP_TEST: "1",
         EDITOR_LAUNCH_SENTINEL: "preserved",
      };
      const environment = attaCutEnvironment(inherited);
      const { stdout } = await promisify(execFile)(
         process.execPath,
         [
            "-e",
            "console.log(JSON.stringify({ renderer: process.env.ELECTRON_RENDERER_URL ?? null, options: process.env.NODE_OPTIONS ?? null, profile: process.env.ACROCLIP_PROFILE ?? null, sentinel: process.env.EDITOR_LAUNCH_SENTINEL }))",
         ],
         { env: environment, windowsHide: true, timeout: 10_000 }
      );
      expect(JSON.parse(stdout)).toEqual({ renderer: null, options: null, profile: null, sentinel: "preserved" });
      for (const key of ["ELECTRON_EXEC_PATH", "ELECTRON_RUN_AS_NODE", "NODE_ENV", "NODE_PATH", "ACROCLIP_COLLECTION", "ACROCLIP_TEST"])
         expect(environment[key]).toBeUndefined();
      expect(environment["PATH"]).toBe(inherited["PATH"]);
      expect(inherited["ELECTRON_RENDERER_URL"]).toBe("http://localhost:5173");
      expect(inherited["ACROCLIP_PROFILE"]).toBe("acroclip-preview");
   });
});

describe("AttaCut locations", () => {
   it("detects an executable on PATH without asking for a location", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "acroclip-attacut-path-"));
      try {
         const executable = path.join(root, process.platform === "win32" ? "AttaCut.exe" : "attacut");
         await writeFile(executable, "owned test file");
         await chmod(executable, 0o700);
         expect(await findAttaCut(path.join(root, "missing-settings.json"), { platform: process.platform, home: root, appData: root, searchPath: root })).toBe(
            executable
         );
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("detects Windows installations in Program Files", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "acroclip-attacut-installed-"));
      try {
         const folder = path.join(root, "Programs", "AttaCut");
         await mkdir(folder, { recursive: true });
         const executable = path.join(folder, "AttaCut.exe");
         await writeFile(executable, "owned test file");
         expect(
            await findAttaCut(path.join(root, "missing-settings.json"), {
               platform: "win32",
               home: root,
               appData: root,
               searchPath: "",
               programFiles: [path.join(root, "Programs")],
            })
         ).toBe(executable);
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("remembers an explicitly chosen executable with spaces and safely forgets a missing one", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "acroclip-attacut-"));
      try {
         const executable = path.join(root, "Dave's portable AttaCut");
         const settings = path.join(root, "attacut.json");
         const locations = { platform: process.platform, home: root, appData: root, searchPath: "" };
         await writeFile(executable, "owned test file");
         await chmod(executable, 0o700);
         expect(await rememberAttaCut(settings, executable, process.platform)).toBe(executable);
         expect(await findAttaCut(settings, locations)).toBe(executable);
         const content = await readFile(settings, "utf8");
         await rm(executable);
         expect(await findAttaCut(settings, locations)).toBeNull();
         expect(await readFile(settings, "utf8")).toBe(content);
         await writeFile(settings, "damaged");
         expect(await findAttaCut(settings, locations)).toBeNull();
         await expect(rememberAttaCut(settings, root, process.platform)).rejects.toThrow("cannot run");
         await expect(rememberAttaCut(settings, "relative.exe", process.platform)).rejects.toThrow("absolute");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});
