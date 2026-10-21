import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";
test("settings autosave retains drafts, merges external changes and retries failed writes", async () => {
   test.setTimeout(100000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-autosave-")),
      collection = join(profile, "clips"),
      broken = join(profile, "retry-collection");
   await mkdir(collection);
   await writeFile(broken, "This is a file, not a collection folder.");
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
         captureAudio: false,
         shortcut: "Control+Alt+Shift+F3",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
      const length = page.getByRole("spinbutton", { name: "Clip length in seconds", exact: true });
      await length.fill("");
      await page.waitForTimeout(550);
      await expect(length).toHaveValue("");
      expect((await page.evaluate(() => window.acroClip.state())).preferences.clipSeconds).toBe(60);
      await length.fill("72");
      await length.fill("73");
      await length.fill("74");
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sound: false });
      });
      await expect(length).toHaveValue("74");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.clipSeconds).toBe(74);
      expect((await page.evaluate(() => window.acroClip.state())).preferences.sound).toBe(false);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Collection", exact: true }).click();
      const pattern = page.getByRole("textbox", { name: "Name pattern", exact: true });
      await expect(pattern).toBeVisible();
      await selectOption(page, "Filename preset", "date-source");
      await expect(pattern).toHaveValue("{date}T{time} {source}");
      await pattern.fill("Moment ");
      await pattern.evaluate((input: HTMLInputElement) => input.setSelectionRange(7, 7));
      await page.locator(".filename-tokens").getByTitle("{source}", { exact: true }).click();
      await expect(pattern).toHaveValue("Moment {source}");
      await expect(pattern).toBeFocused();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.filenameTemplate).toBe("Moment {source}");
      await pattern.fill("../invalid");
      await page.waitForTimeout(550);
      expect((await page.evaluate(() => window.acroClip.state())).preferences.filenameTemplate).toBe("Moment {source}");
      await expect(pattern).toHaveValue("../invalid");
      await pattern.fill("Moment {date} {source}");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.filenameTemplate).toBe("Moment {date} {source}");
      await app.evaluate(({ ipcMain }, folder) => {
         ipcMain.removeHandler("choose-folder");
         ipcMain.handle("choose-folder", () => folder);
      }, broken);
      await page.getByRole("button", { name: "Choose folder", exact: true }).click();
      await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible({ timeout: 15000 });
      expect((await page.evaluate(() => window.acroClip.state())).preferences.collection).toBe(collection);
      await expect(page.locator(".toast.error")).toHaveCount(0);
      await unlink(broken);
      await mkdir(broken);
      await page.getByRole("button", { name: "Retry save", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.collection).toBe(broken);
      await expect(page.getByRole("status", { name: "Settings saved", exact: true })).toBeVisible();
      await page.locator(".settings-sidebar").getByRole("button", { name: "Sharing", exact: true }).click();
      const shareSize = page.getByRole("spinbutton", { name: "Default shareable size in MB", exact: true });
      await shareSize.fill("");
      await app.evaluate(({ ipcMain }) => {
         ipcMain.removeHandler("reveal");
         ipcMain.handle("reveal", (_event, path: string) => {
            (globalThis as typeof globalThis & { revealedCollection?: string }).revealedCollection = path;
         });
      });
      for (const narrow of [false, true]) {
         if (narrow) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680));
         await page.getByRole("button", { name: "Library", exact: true }).click();
         await page.getByRole("button", { name: "Collection actions", exact: true }).click();
         await page.getByRole("menuitem", { name: "Choose folder in settings", exact: true }).click();
         await expect(page.locator(".settings-heading h1")).toHaveText("Collection");
         await expect(page.getByRole("button", { name: "Choose folder", exact: true })).toBeFocused();
         await expect(page.getByRole("group", { name: "Collection folder", exact: true })).toHaveAttribute("data-navigation-highlight", "true");
         await expect(page.getByRole("button", { name: "Choose folder", exact: true })).toBeInViewport();
         const [chooseBounds, openBounds] = await page.getByRole("group", { name: "Collection folder", exact: true }).evaluate((group) =>
            Array.from(group.querySelectorAll("button"), (button) => {
               const { x, y, width, height } = button.getBoundingClientRect();
               return { x, y, width, height };
            })
         );
         const open = page.getByRole("button", { name: "Open collection folder", exact: true });
         expect(openBounds!.x).toBeGreaterThanOrEqual(chooseBounds!.x + chooseBounds!.width);
         expect(Math.abs(openBounds!.y + openBounds!.height / 2 - (chooseBounds!.y + chooseBounds!.height / 2))).toBeLessThan(1);
         await open.click();
         await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { revealedCollection?: string }).revealedCollection)).toBe(broken);
         const [labelBounds, presetBounds, patternBounds] = await page.locator(".filename-editor").evaluate((editor) =>
            ['label[for="filename-pattern"]', '[role="combobox"]', "#filename-pattern"].map((selector) => {
               const { x, y, width, height } = editor.querySelector(selector)!.getBoundingClientRect();
               return { x, y, width, height };
            })
         );
         expect(Math.abs(labelBounds!.y + labelBounds!.height / 2 - (presetBounds!.y + presetBounds!.height / 2))).toBeLessThan(1);
         expect(patternBounds!.y).toBeGreaterThanOrEqual(presetBounds!.y + presetBounds!.height);
         expect(patternBounds!.width).toBeGreaterThan(presetBounds!.width);

         await page.locator(".settings-sidebar").getByRole("button", { name: "Sharing", exact: true }).click();
         await expect(shareSize).toHaveValue("");
      }
      await shareSize.fill("20");
   } finally {
      await app.close();
   }
});
