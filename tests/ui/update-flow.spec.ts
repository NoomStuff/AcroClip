import { packagedFixture } from "./packaged-fixture";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { defaultPreferences } from "../../src/shared/defaults";
import type * as ElectronUpdater from "electron-updater";

test("AttaCut update chip and verified portable lifecycle share state with Settings", async () => {
   test.skip(process.platform !== "win32", "Portable distribution is Windows-only");
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-update-flow-")),
      collection = join(profile, "clips"),
      downloads = join(profile, "Downloads");
   await mkdir(collection);
   await mkdir(downloads);
   const bytes = Buffer.from("A verified fixture package. This is test data, not an executable."),
      digest = createHash("sha256").update(bytes).digest("hex");
   await writeFile(join(downloads, `AcroClip-99.0.0-win-${process.arch}.exe`), "Keep previous download");
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         sourceKind: "app",
         sourceId: "window:0:0",
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F11",
      })
   );
   const app = await electron.launch({
      executablePath: await packagedFixture(profile),
      args: ["--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, PORTABLE_EXECUTABLE_FILE: join(profile, "AcroClip.exe") },
   });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      await app.evaluate(
         ({ app, net, shell }, { downloads, bytes, digest }) => {
            const getPath = app.getPath.bind(app);
            app.getPath = (name) => (name === "downloads" ? downloads : getPath(name));
            const fixture = globalThis as typeof globalThis & {
               updateFixture?: { version: string; payloads: number; finish?: () => void; revealed?: string; opened?: string; installs: number };
            };
            const state = { version: "99.0.0", payloads: 0, installs: 0 } as NonNullable<typeof fixture.updateFixture>;
            fixture.updateFixture = state;
            shell.showItemInFolder = (path) => {
               state.revealed = path;
            };
            shell.openExternal = async (url) => {
               state.opened = url;
            };
            net.fetch = async (input) => {
               const url = String(input);
               if (url.endsWith("/latest"))
                  return Response.json({
                     tag_name: `v${state.version}`,
                     name: "Fixture release",
                     html_url: `https://github.com/NoomStuff/AcroClip/releases/tag/v${state.version}`,
                     draft: false,
                     prerelease: false,
                  });
               if (url.includes("/tags/"))
                  return Response.json({
                     assets: [
                        {
                           name: `AcroClip-${state.version}-win-${process.arch}.exe`,
                           browser_download_url: "https://example.invalid/payload",
                           digest: `sha256:${digest}`,
                        },
                     ],
                  });
               state.payloads++;
               if (state.payloads === 1) return new Response("damaged bytes");
               const data = new Uint8Array(bytes),
                  half = Math.floor(data.length / 2);
               return new Response(
                  new ReadableStream({
                     start(controller) {
                        controller.enqueue(data.slice(0, half));
                        state.finish = () => {
                           controller.enqueue(data.slice(half));
                           controller.close();
                        };
                     },
                  }),
                  { headers: { "content-length": String(data.length) } }
               );
            };
         },
         { downloads, bytes: [...bytes], digest }
      );
      const startup = page.getByRole("checkbox", { name: "Check for updates at startup", exact: true });
      await startup.uncheck();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.updateCheck).toBe(false);
      await expect(page.locator(".settings-sidebar").getByRole("status", { name: "Settings saved", exact: true })).toBeVisible();
      await expect(page.locator(".settings-heading").getByRole("status")).toHaveCount(0);
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      const chip = page.locator(".update-chip-wrap button");
      await expect(chip).toHaveAttribute("aria-label", "Download update");
      const label = await page.locator(".window-page").boundingBox(),
         spacer = await page.locator(".titlebar-drag").boundingBox();
      expect(label!.x + label!.width).toBeLessThanOrEqual(spacer!.x);
      await chip.click();
      await expect(chip).toHaveAttribute("aria-label", "Retry download");
      await expect(chip).toHaveAttribute("title", /verification/);
      expect((await readdir(downloads)).filter((name) => name.endsWith(".part"))).toEqual([]);
      await page.screenshot({ path: "test-results/update-chip-checksum-error.png" });
      await chip.click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).update.progress).toBeGreaterThan(0);
      await expect(chip).toHaveAttribute("aria-disabled", "true");
      const payloads = await app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { payloads: number } }).updateFixture.payloads);
      await chip.dispatchEvent("click");
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { payloads: number } }).updateFixture.payloads)).toBe(payloads);
      for (const width of [1380, 980]) {
         await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, width === 980 ? 680 : 900), width);
         await chip.hover();
         await page.screenshot({ path: `test-results/update-chip-progress-${width}.png` });
      }
      await app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { finish?: () => void } }).updateFixture.finish?.());
      await expect(chip).toHaveAttribute("aria-label", "Show in Downloads");
      const downloaded = (await page.evaluate(() => window.acroClip.state())).update.path!;
      expect(await readFile(downloaded)).toEqual(bytes);
      expect(await readFile(join(downloads, `AcroClip-99.0.0-win-${process.arch}.exe`), "utf8")).toBe("Keep previous download");
      await chip.click();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { revealed?: string } }).updateFixture.revealed)).toBe(downloaded);
      await page.screenshot({ path: "test-results/update-chip-downloaded.png" });
      await app.evaluate(() => {
         process.env["PORTABLE_EXECUTABLE_FILE"] = "";
         (globalThis as typeof globalThis & { updateFixture: { version: string } }).updateFixture.version = "99.0.1";
      });
      await page.evaluate(() => window.acroClip.checkUpdate());
      await expect(chip).toHaveAttribute("aria-label", "View release");
      await chip.click();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { opened?: string } }).updateFixture.opened)).toBe(
         "https://github.com/NoomStuff/AcroClip/releases/tag/v99.0.1"
      );
      await app.evaluate(({ app }) => {
         const fs = process.getBuiltinModule("fs"),
            exists = fs.existsSync;
         fs.existsSync = (path) => String(path).endsWith("app-update.yml") || exists(path);
         process.getBuiltinModule("module").syncBuiltinESMExports();
         const updater = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`)("electron-updater") as typeof ElectronUpdater;
         updater.autoUpdater.checkForUpdates = async () =>
            ({ downloadPromise: new Promise<never>(() => {}) }) as unknown as Awaited<ReturnType<typeof updater.autoUpdater.checkForUpdates>>;
         updater.autoUpdater.quitAndInstall = () => {
            (globalThis as typeof globalThis & { updateFixture: { installs: number } }).updateFixture.installs++;
         };
         (globalThis as typeof globalThis & { updateFixture: { version: string } }).updateFixture.version = "99.0.2";
      });
      await page.evaluate(() => window.acroClip.checkUpdate());
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).update.mode).toBe("automatic");
      await app.evaluate(({ app }) => {
         const updater = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`)("electron-updater") as typeof ElectronUpdater;
         updater.autoUpdater.emit("download-progress", { percent: 37, total: 100, delta: 37, transferred: 37, bytesPerSecond: 100 });
         updater.autoUpdater.emit("update-downloaded", {
            version: "99.0.2",
            downloadedFile: "fixture-installer.exe",
            files: [],
            path: "fixture-installer.exe",
            sha512: "",
            releaseDate: "2026-10-18T12:00:00Z",
         });
      });
      await expect(chip).toHaveAttribute("aria-label", "Apply and restart");
      await page.screenshot({ path: "test-results/update-chip-ready.png" });
      await chip.click();
      // The production shutdown callback waits for the native helper to exit
      // before invoking the installer. CI teardown can exceed the default 5s.
      await expect
         .poll(() => app.evaluate(() => (globalThis as typeof globalThis & { updateFixture: { installs: number } }).updateFixture.installs), { timeout: 20000 })
         .toBe(1);
   } finally {
      await app.close();
   }
});
