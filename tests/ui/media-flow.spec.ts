import { mediaTool } from "./media-tool";
import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";

declare global {
   interface Window {
      firstPlaybackReveal?: { from: number; to: number; duration: number };
      restorePlayerFrameCallbacks?: () => void;
   }
}

test("real media plays, creates a verified shareable, and supports overlapping tags", async () => {
   test.setTimeout(120000);
   const profile = await realpath(await mkdtemp(join(tmpdir(), "acroclip-media-ui-")));
   const collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   const source = join(collection, "Desktop moment.mp4");
   await promisify(execFile)(
      mediaTool("ffmpeg"),
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
      await clipButton.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Tags", exact: true }).hover();
      const emptyTagsMenu = page.getByRole("menu", { name: "Tags", exact: true });
      await expect(emptyTagsMenu.getByRole("separator")).toHaveCount(0);
      await emptyTagsMenu.getByRole("menuitem", { name: "Create tag", exact: true }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("Best moments");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByRole("button", { name: /Best moments/ }).first()).toBeVisible();
      await page.getByRole("button", { name: "New tag", exact: true }).first().click();
      await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("Funny");
      await page.getByRole("button", { name: "Create", exact: true }).click();
      await page.locator(".clip-card").hover();
      await page.getByRole("button", { name: "Actions for Desktop moment", exact: true }).click();
      await page.getByRole("menuitem", { name: "Tags", exact: true }).hover();
      const categories = page.getByRole("menu", { name: "Tags", exact: true });
      await expect(categories).toBeVisible();
      await expect(categories.getByRole("separator")).toHaveCount(1);
      await expect(categories.getByRole("menuitem", { name: "Create tag", exact: true })).toBeVisible();
      await categories.getByRole("menuitemcheckbox", { name: "Best moments", exact: true }).click();
      await categories.getByRole("menuitemcheckbox", { name: "Funny", exact: true }).click();
      await expect(categories.getByRole("menuitemcheckbox", { name: "Best moments", exact: true })).toBeChecked();
      await expect(categories.getByRole("menuitemcheckbox", { name: "Funny", exact: true })).toBeChecked();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.categories.length).toBe(2);
      await desktop.evaluate(({ ipcMain }) => {
         ipcMain.removeAllListeners("drag");
         ipcMain.on("drag", (_event, path: string) => {
            (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath = path;
         });
      });
      await page.getByRole("button", { name: "Open Desktop moment", exact: true }).dispatchEvent("dragstart");
      await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { testDragPath?: string }).testDragPath)).toBe(source);
      await page.evaluate(() => {
         const observer = new MutationObserver(() => {
            const node = document.querySelector(".player-video.ready");
            const animation = node?.getAnimations()[0];
            if (!animation) return;
            const frames = (animation.effect as KeyframeEffect).getKeyframes();
            window.firstPlaybackReveal = {
               from: Number(frames[0]?.["opacity"]),
               to: Number(frames.at(-1)?.["opacity"]),
               duration: Number(animation.effect?.getTiming().duration),
            };
            observer.disconnect();
         });
         observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
      });
      await page.getByRole("button", { name: "Open Desktop moment", exact: true }).click();
      await expect(page.locator(".player-video")).toHaveClass(/ready/);
      expect(await page.evaluate(() => window.firstPlaybackReveal)).toEqual({ from: 0, to: 1, duration: 140 });
      await expect(page.locator(".video-loading")).toHaveCount(0);
      await page.getByRole("button", { name: "Shareable", exact: true }).click();
      await expect(page.getByText("No shareable", { exact: true })).toBeVisible();
      await expect(page.locator(".player-poster")).toHaveCount(0);
      await expect(page.locator(".player-outgoing")).toBeHidden();
      await page.evaluate(() => {
         const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
         const cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
         window.restorePlayerFrameCallbacks = () => {
            HTMLVideoElement.prototype.requestVideoFrameCallback = request;
            HTMLVideoElement.prototype.cancelVideoFrameCallback = cancel;
         };
         // A paused seek may not deliver another presentation callback. The
         // actual decoded video must still become visible via media events.
         HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0;
         HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
      });
      await page.getByRole("button", { name: "Clip", exact: true }).click();
      await expect(page.locator(".player-video")).toHaveClass(/ready/);
      await page.evaluate(() => window.restorePlayerFrameCallbacks?.());
      await expect(page.locator(".viewer-title")).not.toContainText("Unknown");
      await expect(page.locator(".viewer-title time")).toBeVisible();
      await expect(page.locator(".viewer-categories")).toContainText("Best moments");
      await expect(page.locator(".viewer-categories")).toContainText("Funny");
      await page.getByRole("button", { name: "File actions", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Delete clip", exact: true })).toBeVisible();
      const fileMenu = page.getByRole("menu", { name: "File actions", exact: true });
      const fileActions = await fileMenu.getByRole("menuitem").allTextContents();
      await expect(fileMenu.getByRole("menuitem", { name: "Show clip in folder", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("menuitem", { name: "Create shareable", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("menuitem", { name: "Tags", exact: true })).toBeVisible();
      await expect(fileMenu.getByRole("menuitem", { name: "Open clip", exact: true })).toHaveCount(0);
      await expect(fileMenu.getByRole("menuitem", { name: "Move to folder", exact: true })).toHaveCount(0);
      await expect(fileMenu.getByRole("separator")).toHaveCount(3);
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
      const sizeDraft = page.getByRole("spinbutton", { name: "Shareable size target in MB", exact: true });
      await sizeDraft.clear();
      await expect(sizeDraft).toHaveValue("");
      await expect(sizeDraft).toHaveAttribute("aria-invalid", "true");
      await sizeDraft.pressSequentially("2001");
      await page.keyboard.press("Enter");
      await expect(sizeDraft).toHaveValue("2001");
      await expect(sizeDraft).toHaveAccessibleDescription("Enter a whole number, 1 to 2000 MB.");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("combobox", { name: "Shareable size: 2 MB (default)", exact: true })).toBeFocused();
      await page.getByRole("combobox", { name: /Shareable size:/ }).click();
      await page.getByRole("option", { name: "Custom", exact: true }).click();
      await sizeDraft.fill("17");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("combobox", { name: "Shareable size: 2 MB (default)", exact: true })).toBeFocused();
      await page.getByRole("combobox", { name: /Shareable size:/ }).click();
      await page.getByRole("option", { name: "Custom", exact: true }).click();
      await sizeDraft.fill("2000");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("acroclip-shortcut", { detail: "createShareable" })));
      expect((await page.evaluate(() => window.acroClip.state())).jobs).toHaveLength(0);
      await page.getByRole("combobox", { name: /Shareable size:/ }).click();
      await page.getByRole("option", { name: "Custom", exact: true }).click();
      await sizeDraft.fill("1");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("combobox", { name: "Shareable size: 1 MB", exact: true })).toBeVisible();
      await expect(sizeDraft).toHaveCount(0);
      expect((await page.evaluate(() => window.acroClip.state())).preferences.shareSizeMB).toBe(2);
      await expect
         .poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState), { timeout: 30000 })
         .toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.2);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const playbackVideo = page.locator(".viewer-main video");
      for (const size of [
         { width: 240, height: 240 },
         { width: 400, height: 100 },
      ]) {
         await playbackVideo.evaluate((node, size) => {
            node.style.width = `${size.width}px`;
            node.style.height = `${size.height}px`;
         }, size);
         await playbackVideo.click({ position: { x: 5, y: 5 } });
         expect(await playbackVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
         await playbackVideo.click({ position: { x: size.width / 2, y: size.height / 2 } });
         await expect.poll(() => playbackVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
         await playbackVideo.click({ position: { x: size.width - 5, y: size.height - 5 } });
         expect(await playbackVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
         await playbackVideo.click({ position: { x: size.width / 2, y: size.height / 2 } });
         await expect.poll(() => playbackVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      }
      await playbackVideo.evaluate((node) => node.removeAttribute("style"));
      await page.getByRole("button", { name: "Mute playback", exact: true }).hover();
      const playbackVolume = page.getByRole("slider", { name: "Playback volume", exact: true });
      for (const [level, icon] of [
         ["0", "volume-x"],
         ["0.01", "volume"],
         ["0.32", "volume"],
         ["0.33", "volume-1"],
         ["0.66", "volume-1"],
         ["0.67", "volume-2"],
         ["1", "volume-2"],
      ] as const) {
         await playbackVolume.fill(level);
         await expect(page.locator(`.player-volume-control > button .lucide-${icon}`)).toBeVisible();
      }
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
      const dangerColor = await page.evaluate(() => {
         const probe = document.createElement("span");
         probe.style.color = "var(--red)";
         document.body.append(probe);
         const color = getComputedStyle(probe).color;
         probe.remove();
         return color;
      });
      const deletes = await fileMenu
         .getByRole("menuitem")
         .filter({ hasText: /^Delete/ })
         .all();
      expect(deletes.length).toBeGreaterThan(1);
      for (const item of deletes) {
         await expect(item).toHaveCSS("color", dangerColor);
         expect(await item.evaluate((node) => node.previousElementSibling?.getAttribute("role"))).toBe("separator");
      }
      await page.keyboard.press("Escape");

      await desktop.evaluate(({ dialog }) => {
         dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
            const message = options ?? (windowOrOptions as Electron.MessageBoxOptions);
            if (message.defaultId !== 0 || message.cancelId !== 0) throw new Error("Deletion must default to Cancel and Escape must cancel");
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
