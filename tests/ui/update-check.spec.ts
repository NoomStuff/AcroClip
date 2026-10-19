import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("manual update check rotates its existing icon without moving or duplicating controls", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-update-check-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F11",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      const snapshot = await page.evaluate(() => window.acroClip.state());
      await app.evaluate(({ ipcMain, BrowserWindow }, snapshot) => {
         const web = BrowserWindow.getAllWindows()[0]!.webContents;
         ipcMain.removeHandler("update-check");
         ipcMain.handle("update-check", async () => {
            const testGlobal = globalThis as typeof globalThis & { checkCalls?: number; finishCheck?: () => void };
            testGlobal.checkCalls = (testGlobal.checkCalls ?? 0) + 1;
            web.send("app-event", {
               type: "state",
               state: { ...snapshot, update: { state: "checking", version: "", progress: 0, message: "Checking for updates" } },
            });
            await new Promise<void>((resolve) => {
               testGlobal.finishCheck = resolve;
            });
            web.send("app-event", {
               type: "state",
               state: { ...snapshot, update: { state: "idle", version: "", progress: 0, message: "You're up to date", lastChecked: Date.now() } },
            });
         });
      }, snapshot);
      const button = page.getByRole("button", { name: "Check for updates", exact: true });
      for (const width of [1380, 980]) {
         await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, width === 980 ? 680 : 900), width);
         await expect(page.locator(".update-message")).not.toBeEmpty();
         const bounds = await button.boundingBox();
         const details = await page.locator(".update-panel > div").boundingBox();
         expect(Math.abs(details!.y + details!.height / 2 - bounds!.y - bounds!.height / 2)).toBeLessThan(1);
         await page.screenshot({ path: `test-results/update-idle-${width}.png` });
         await button.click();
         await expect(button).toHaveAttribute("aria-busy", "true");
         await expect(button).toBeDisabled();
         await expect(button.locator("svg")).toHaveCount(1);
         await expect(button.locator("svg")).toHaveCSS("animation-name", "rotate");
         const during = await button.boundingBox();
         expect(during!.width).toBe(bounds!.width);
         expect(during!.height).toBe(bounds!.height);
         expect(Math.abs(during!.y - bounds!.y)).toBeLessThan(1);
         await page.screenshot({ path: `test-results/update-check-${width}.png` });
         await page.emulateMedia({ reducedMotion: "reduce" });
         await expect(button.locator("svg")).toHaveCSS("animation-name", "none");
         await page.emulateMedia({ reducedMotion: "no-preference" });
         await app.evaluate(() => (globalThis as typeof globalThis & { finishCheck?: () => void }).finishCheck?.());
         await expect(button).toBeEnabled();
         await expect(page.locator(".update-message")).toContainText("Last checked");
         await expect(button.locator("svg")).toHaveCount(1);
      }
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { checkCalls?: number }).checkCalls)).toBe(2);
   } finally {
      await app.close();
   }
});

test("development checks fetch release metadata and offer only a release link", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-dev-update-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F3",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await app.evaluate(({ net, shell }) => {
         const fixture = globalThis as typeof globalThis & { metadataChecks?: number; openedRelease?: string };
         fixture.metadataChecks = 0;
         net.fetch = async () => {
            fixture.metadataChecks!++;
            return Response.json({
               tag_name: "v99.0.0",
               name: "AcroClip 99.0.0",
               html_url: "https://example.com/releases/v99.0.0",
               draft: false,
               prerelease: false,
            });
         };
         shell.openExternal = async (url) => {
            fixture.openedRelease = url;
         };
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(page.locator(".update-message")).toHaveText("An update is available");
      await expect(page.getByRole("button", { name: "Apply and restart", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Download update", exact: true })).toHaveCount(0);
      await page.locator(".update-panel").getByRole("button", { name: "View release", exact: true }).click();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { metadataChecks: number }).metadataChecks)).toBe(1);
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { openedRelease: string }).openedRelease)).toBe(
         "https://example.com/releases/v99.0.0"
      );
      expect((await page.evaluate(() => window.acroClip.state())).update).toMatchObject({
         state: "available",
         mode: "releases",
         lastChecked: expect.any(Number),
      });
   } finally {
      await app.close();
   }
});
