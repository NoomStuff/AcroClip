import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";

test("real media plays, creates a verified shareable, and supports overlapping categories", async () => {
   test.setTimeout(120000);
   const profile = await realpath(await mkdtemp(join(tmpdir(), "acroclip-media-ui-")));
   const collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   const source = join(collection, "Desktop moment.mp4");
   await promisify(execFile)(
      resolve("resources/media/ffmpeg.exe"),
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=960x540:rate=30",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=440:sample_rate=48000",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=880:sample_rate=48000",
         "-t",
         "6",
         "-map",
         "0:v",
         "-map",
         "1:a",
         "-map",
         "2:a",
         "-c:v",
         "libx264",
         "-preset",
         "ultrafast",
         "-crf",
         "18",
         "-c:a",
         "aac",
         "-metadata:s:a:0",
         "title=Master",
         "-metadata:s:a:0",
         "handler_name=Master",
         "-metadata:s:a:1",
         "title=Microphone",
         "-metadata:s:a:1",
         "handler_name=Microphone",
         source,
      ],
      { windowsHide: true }
   );
   const originalHash = createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F6",
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         shareSizeMB: 2,
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open Desktop moment", exact: true })).toBeVisible({ timeout: 30000 });
      await expect(page.locator(".clip-card-info p")).not.toContainText("Unknown");
      const clipButton = page.getByRole("button", { name: "Open Desktop moment", exact: true });
      await clipButton.click({ button: "right" });
      await expect(page.getByRole("menu", { name: "Actions for Desktop moment", exact: true })).toBeVisible();
      const contextActions = await page.getByRole("menuitem").allTextContents();
      await page.keyboard.press("Escape");
      await expect(clipButton).toBeFocused();
      await page.getByRole("textbox", { name: "Search clips", exact: true }).fill("no match");
      await page.getByRole("textbox", { name: "Search clips", exact: true }).clear();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.getByRole("button", { name: "List view", exact: true }).click();
      await clipButton.focus();
      await page.keyboard.press("Shift+F10");
      await expect(page.getByRole("menu", { name: "Actions for Desktop moment", exact: true })).toBeVisible();
      expect(await page.getByRole("menuitem").allTextContents()).toEqual(contextActions);
      await page.keyboard.press("Escape");
      await expect(clipButton).toBeFocused();
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
      await page.getByRole("button", { name: "New category", exact: true }).first().click();
      await page.getByRole("textbox", { name: "Category name", exact: true }).fill("Best moments");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByRole("button", { name: /Best moments/ }).first()).toBeVisible();
      await page.getByRole("button", { name: "New category", exact: true }).first().click();
      await page.getByRole("textbox", { name: "Category name", exact: true }).fill("Funny");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.locator(".clip-card").hover();
      await page.getByRole("button", { name: "Actions for Desktop moment", exact: true }).click();
      await page.getByRole("menuitem", { name: "Categories", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Clip categories" });
      await dialog.evaluate((node) => {
         const choices = [...node.querySelectorAll<HTMLButtonElement>("button.category-option")];
         choices.find((button) => button.textContent?.trim() === "Best moments")!.click();
         choices.find((button) => button.textContent?.trim() === "Funny")!.click();
      });
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.categories.length).toBe(2);
      await desktop.evaluate(({ ipcMain }) => {
         ipcMain.removeAllListeners("drag");
         ipcMain.on("drag", (_event, path: string) => {
            (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath = path;
         });
      });
      await page.getByRole("button", { name: "Open Desktop moment", exact: true }).dispatchEvent("dragstart");
      await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath)).toBe(source);
      await page.getByRole("button", { name: "Open Desktop moment", exact: true }).click();
      await expect(page.locator(".viewer-title")).not.toContainText("Unknown");
      await expect(page.locator(".viewer-title time")).toBeVisible();
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Delete clip", exact: true })).toBeVisible();
      const fileMenu = page.getByRole("menu", { name: "File actions", exact: true });
      const fileActions = await fileMenu.getByRole("menuitem").allTextContents();
      await expect(fileMenu.getByRole("menuitem", { name: "Show clip in folder", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("menuitem", { name: "Create shareable", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("separator")).toHaveCount(2);
      await page.keyboard.press("Escape");
      await page.locator(".viewer-main video").click({ button: "right" });
      await expect(fileMenu).toBeVisible();
      expect(await fileMenu.getByRole("menuitem").allTextContents()).toEqual(fileActions);
      await page.keyboard.press("Escape");
      await expect(page.locator(".viewer-main video")).toBeFocused();
      await desktop.evaluate(() => {
         delete (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath;
      });
      await page.locator(".viewer-main video").dispatchEvent("dragstart");
      await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath)).toBe(source);
      await page.getByRole("combobox", { name: "Shareable size: 2 MB (default)", exact: true }).click();
      await page.getByRole("option", { name: "Custom", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Shareable size target in MB", exact: true }).fill("2000");
      await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: "createShareable" })));
      expect((await page.evaluate(() => window.acroClip.state())).jobs).toHaveLength(0);
      await page.getByRole("spinbutton", { name: "Shareable size target in MB", exact: true }).fill("1");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("combobox", { name: "Shareable size: 1 MB", exact: true })).toBeFocused();
      expect((await page.evaluate(() => window.acroClip.state())).preferences.shareSizeMB).toBe(2);
      await expect
         .poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState), { timeout: 30000 })
         .toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.2);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Mute playback", exact: true }).hover();
      await page.getByRole("slider", { name: "Playback volume", exact: true }).fill("0.37");
      await page.getByRole("button", { name: "Mute playback", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
      await page.getByRole("button", { name: "Unmute playback", exact: true }).click();
      expect(await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.volume)).toBeCloseTo(0.37);

      await page.getByRole("button", { name: "Mute playback", exact: true }).hover();
      const volumeSlider = page.getByRole("slider", { name: "Playback volume", exact: true });
      await volumeSlider.dispatchEvent("pointerdown", { pointerType: "mouse" });
      await volumeSlider.fill("0.18");
      await volumeSlider.fill("0");
      await volumeSlider.dispatchEvent("pointerup", { pointerType: "mouse" });
      await expect(page.getByRole("button", { name: "Unmute playback", exact: true })).toBeVisible();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
      await page.getByRole("button", { name: "Unmute playback", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
      expect(await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.volume)).toBeCloseTo(0.37);
      await page.getByRole("button", { name: "Mute playback", exact: true }).hover();
      await volumeSlider.focus();
      await volumeSlider.press("Home");
      await expect(page.getByRole("button", { name: "Unmute playback", exact: true })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: "mutePlayback" })));
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
      expect(await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.volume)).toBeCloseTo(0.37);

      await selectOption(page, "Playback speed", "1.5");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.5);
      await page.getByRole("slider", { name: "Playback position", exact: true }).fill("2");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      const position = page.getByRole("slider", { name: "Playback position", exact: true });
      await expect(position).toHaveValue("2");
      await position.press("ArrowRight");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(2.9);
      await position.press("ArrowLeft");
      await expect(position).toHaveValue("2");
      await selectOption(page, "Audio tracks", "2");
      await expect(page.getByRole("listbox", { name: "Audio tracks", exact: true })).toHaveAttribute("aria-multiselectable", "true");
      await expect(page.getByRole("option", { name: "Master", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("option", { name: "Microphone", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("option", { name: "Master", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect
         .poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState), { timeout: 30000 })
         .toBeGreaterThanOrEqual(2);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
      const isolatedTrackUrl = await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentSrc);
      await selectOption(page, "Audio tracks", "1");
      await page.getByRole("option", { name: "Microphone", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentSrc)).not.toBe(isolatedTrackUrl);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("slider", { name: "Playback position", exact: true }).fill("2");
      await page.getByRole("button", { name: "Fullscreen", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
      await page.locator(".viewer-main video").click({ button: "right" });
      await expect(fileMenu).toBeVisible();
      expect(await fileMenu.evaluate((node) => document.fullscreenElement?.contains(node))).toBe(true);
      await fileMenu.getByRole("menuitem", { name: "Rename clip", exact: true }).click();
      const renameDialog = page.getByRole("dialog", { name: "Rename clip", exact: true });
      await expect(renameDialog).toBeVisible();
      expect(await renameDialog.evaluate((node) => document.fullscreenElement?.contains(node))).toBe(true);
      await renameDialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("combobox", { name: "Audio tracks", exact: true }).click();
      await expect(page.getByRole("listbox", { name: "Audio tracks" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
      await page.getByRole("button", { name: "Create shareable", exact: true }).click();
      await expect(page.locator(".viewer-create-main .button[data-progress]")).toBeVisible();
      await expect(page.getByRole("combobox", { name: /Shareable size:/ })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Cancel shareable", exact: true })).toBeVisible();

      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.shareables.length, { timeout: 90000 }).toBe(1);
      const result = await page.evaluate(() => window.acroClip.state());
      expect(result.clips[0]?.shareables[0]?.size).toBeLessThanOrEqual(1000000);
      expect(
         createHash("sha256")
            .update(await readFile(source))
            .digest("hex")
      ).toBe(originalHash);
      await page.getByRole("button", { name: "Shareable", exact: true }).click();
      await expect
         .poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState), { timeout: 30000 })
         .toBeGreaterThanOrEqual(2);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      await desktop.evaluate(() => {
         delete (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath;
      });
      await page.locator(".viewer-main video").dispatchEvent("dragstart");
      await expect
         .poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath))
         .toBe(result.clips[0]!.shareables[0]!.path);

      const firstShare = result.clips[0]!.shareables[0]!;
      const firstBytes = await readFile(firstShare.path);
      await page.getByRole("button", { name: "Create shareable", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.shareables.length, { timeout: 90000 }).toBe(2);
      const copies = (await page.evaluate(() => window.acroClip.state())).clips[0]!.shareables;
      expect(new Set(copies.map((copy) => copy.path)).size).toBe(2);
      expect(copies.map((copy) => copy.targetMB)).toEqual([1, 1]);
      expect(await readFile(firstShare.path)).toEqual(firstBytes);
      expect(
         createHash("sha256")
            .update(await readFile(source))
            .digest("hex")
      ).toBe(originalHash);
      await selectOption(page, "Choose shareable", firstShare.id);
      await expect(page.getByRole("combobox", { name: "Choose shareable", exact: true })).not.toContainText("target");
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await expect(fileMenu.getByRole("menuitem", { name: "Show clip in folder", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("menuitem", { name: "Show shareable in folder", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");

      await desktop.evaluate(({ dialog }) => {
         dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
            (globalThis as typeof globalThis & { testDeletePrompt?: string }).testDeletePrompt = (
               options ?? (windowOrOptions as Electron.MessageBoxOptions)
            ).message;
            return { response: 0, checkboxChecked: false };
         };
      });
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Delete shareable [0-9]+$/, exact: false }).click();
      await expect
         .poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDeletePrompt?: string }).testDeletePrompt))
         .toBe("Move this shareable to the trash?");
      expect((await page.evaluate(() => window.acroClip.state())).clips[0]!.shareables).toHaveLength(2);
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete all shareables", exact: true }).click();
      await expect
         .poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDeletePrompt?: string }).testDeletePrompt))
         .toBe("Move all shareables for this clip to the trash?");
      expect((await page.evaluate(() => window.acroClip.state())).clips[0]!.shareables).toHaveLength(2);
      await page.getByRole("button", { name: "Clip", exact: true }).click();
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete clip", exact: true }).click();
      await expect
         .poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDeletePrompt?: string }).testDeletePrompt))
         .toBe("Move this clip and its shareables to the trash?");
      expect((await page.evaluate(() => window.acroClip.state())).clips[0]!.shareables).toHaveLength(2);
      expect(await readFile(firstShare.path)).toEqual(firstBytes);
      await page.getByRole("button", { name: "Shareable", exact: true }).click();

      await page.getByRole("button", { name: "Create shareable", exact: true }).click();
      await expect(page.getByRole("button", { name: "Cancel shareable", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel shareable", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).jobs.some((job) => job.state === "cancelled")).toBe(true);
      await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeEnabled();
      expect((await page.evaluate(() => window.acroClip.state())).clips[0]!.shareables).toHaveLength(2);
      await desktop.evaluate(({ ipcMain }) => {
         ipcMain.removeHandler("share");
         ipcMain.handle("share", () => {
            throw new Error("Fixture export failure");
         });
      });
      await page.getByRole("button", { name: "Create shareable", exact: true }).click();
      await expect(page.locator(".toast.error")).toContainText("Fixture export failure");
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
      await page.evaluate(() => window.acroClip.window("minimize"));
      await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      await desktop.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows()[0];
         window?.restore();
         window?.show();
      });
      await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(false);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      await page.getByRole("button", { name: "Library", exact: true }).first().click();
      await page
         .getByRole("button", { name: /Best moments/ })
         .first()
         .click();
      await expect(page.getByRole("button", { name: "Open Desktop moment", exact: true })).toBeVisible();
      await page
         .getByRole("button", { name: /^Funny/ })
         .first()
         .click();
      await expect(page.getByRole("button", { name: "Open Desktop moment", exact: true })).toBeVisible();
   } finally {
      await desktop.close();
   }
});
