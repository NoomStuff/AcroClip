import { packagedFixture } from "./packaged-fixture";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type * as ElectronUpdater from "electron-updater";

test("a failed update install leaves the app usable and the clip shortcut registered", async () => {
   test.skip(process.platform !== "win32", "Windows installer failure boundary");
   const profile = await mkdtemp(join(tmpdir(), "acroclip-update-ui-"));
   const collection = join(profile, "clips");
   const shortcut = "Control+Alt+Shift+F12";
   await mkdir(collection, { recursive: true });
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         sourceKind: "app",
         sourceId: "window:0:0",
         shortcut,
      })
   );
   const desktop = await electron.launch({
      executablePath: await packagedFixture(profile),
      args: ["--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeVisible();
      await expect.poll(() => desktop.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), shortcut)).toBe(true);
      // Exercise the production Updates object and shutdown callback. Replace only
      // its external installer boundary, which can fail without quitting Electron.
      await desktop.evaluate(async ({ app, net }) => {
         const module = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`)("electron-updater") as typeof ElectronUpdater;
         const fs = process.getBuiltinModule("fs"),
            exists = fs.existsSync;
         fs.existsSync = (path) => String(path).endsWith("app-update.yml") || exists(path);
         process.getBuiltinModule("module").syncBuiltinESMExports();
         net.fetch = async () =>
            Response.json({
               tag_name: "v99.0.0",
               name: "Fixture",
               html_url: "https://github.com/NoomStuff/AcroClip/releases/tag/v99.0.0",
               draft: false,
               prerelease: false,
            });
         const updater = module.autoUpdater;
         updater.checkForUpdates = async () =>
            ({ downloadPromise: new Promise<never>(() => {}) }) as unknown as Awaited<ReturnType<typeof updater.checkForUpdates>>;
         updater.quitAndInstall = () => {
            updater.emit("error", new Error("The update installer could not start"));
         };
      });
      await page.evaluate(() => window.acroClip.checkUpdate());
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).update.state)).toBe("downloading");
      await desktop.evaluate(async ({ app }) => {
         const module = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`)("electron-updater") as typeof ElectronUpdater;
         module.autoUpdater.emit("update-downloaded", {
            version: "99.0.0",
            downloadedFile: "AcroClip-test-installer.exe",
            files: [],
            path: "AcroClip-test-installer.exe",
            sha512: "",
            releaseDate: "2026-10-08T12:00:00.000Z",
         });
      });
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).update.state)).toBe("ready");
      await page.evaluate(() => window.acroClip.installUpdate());
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).update.state)).toBe("error");
      await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeVisible();
      await expect.poll(() => desktop.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), shortcut)).toBe(true);
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, shareSizeMB: 42 });
      });
      expect((await page.evaluate(() => window.acroClip.state())).preferences.shareSizeMB).toBe(42);
   } finally {
      await desktop.close();
   }
});
