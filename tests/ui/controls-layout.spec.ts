import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";

test("controls support exact entry, pointer snapping, keyboard input and persistent constrained panes", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-controls-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await promisify(execFile)(resolve("resources/media/ffmpeg.exe"), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=15",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      join(collection, "Controls fixture.mp4"),
   ]);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         setupComplete: true,
         collection,
         sourceKind: "app",
         sourceId: "window:0:0",
         shortcut: "Control+Alt+Shift+F6",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      const level = page.getByRole("slider", { name: "Source audio level", exact: true });
      await expect(level).toBeVisible();
      expect(await page.locator(".mixer-scroll").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const fonts = await page.context().newCDPSession(page);
      await fonts.send("DOM.enable");
      await fonts.send("CSS.enable");
      const { root } = await fonts.send("DOM.getDocument");
      const { nodeId } = await fonts.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".mixer-channel-name" });
      console.log("Rendered control fonts", await fonts.send("CSS.getPlatformFontsForNode", { nodeId }));
      const number = page.getByRole("textbox", { name: "Source audio level in decibels", exact: true });
      await number.fill("-6");
      await number.press("Enter");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume, { timeout: 15000 }).toBe(0.5);
      await expect(level).toHaveValue("0.5");
      await expect(number).toHaveValue("-6.0");
      await number.fill("+6.0206");
      await number.press("Enter");
      await expect(level).toHaveValue("1.41");
      await expect(number).toHaveValue("+6.0");
      await number.fill("+12");
      await number.press("Enter");
      await expect(number).toHaveValue("+12.0");
      await expect(level).toHaveValue("1.41");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume).toBe(3.98);
      await number.fill("-inf");
      await number.press("Enter");
      await expect(level).toHaveValue("0");
      await level.focus();
      await level.press("Home");
      await level.press("End");
      await expect(level).toHaveValue("1.41");
      await level.press("Delete");
      await expect(level).toHaveValue("1");
      await expect(number).toHaveValue("0.0");
      await level.press("ArrowLeft");
      await expect(level).toHaveValue("0.99");
      await number.fill("invalid");
      await number.press("Enter");
      await expect(level).toHaveValue("0.99");
      await number.fill("-20");
      await number.press("Escape");
      await number.blur();
      await expect(level).toHaveValue("0.99");
      await level.dblclick();
      await expect(level).toHaveValue("1");
      expect((await level.boundingBox())!.height).toBe(28);
      await expect(page.getByRole("button", { name: "Source audio options", exact: true })).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Audio", exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Capture source", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Mute source audio", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureMuted).toBe(true);
      await page.getByRole("button", { name: "Unmute source audio", exact: true }).click();
      const peakMeter = page.getByRole("meter", { name: "Source audio peak", exact: true });
      await desktop.evaluate(({ BrowserWindow }) =>
         BrowserWindow.getAllWindows()[0]!.webContents.send("app-event", { type: "audio-levels", levels: { capture: 100, microphone: 0 } })
      );
      await expect(peakMeter).toHaveAttribute("data-clipping", "true");
      await desktop.evaluate(({ BrowserWindow }) =>
         BrowserWindow.getAllWindows()[0]!.webContents.send("app-event", { type: "audio-levels", levels: { capture: 0, microphone: 0 } })
      );
      await expect.poll(() => peakMeter.evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue("--meter-level")))).toBeLessThan(100);
      expect(await peakMeter.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--meter-peak"))).toBe("100%");
      await expect
         .poll(() => peakMeter.evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue("--meter-peak"))), { timeout: 4000 })
         .toBeLessThan(100);
      for (const selector of [".titlebar", ".rail", ".status-strip"])
         expect(await page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(0, 0, 0)");
      const addSource = page.getByRole("button", { name: "Add audio source", exact: true });
      const mixerBefore = await page.locator(".mixer").boundingBox();
      await addSource.click();
      const sourceDialog = page.getByRole("dialog", { name: "Add audio source", exact: true });
      await expect(sourceDialog).toBeVisible();
      await expect(sourceDialog.getByRole("combobox", { name: "Audio source type", exact: true })).toBeFocused();
      expect(await page.locator(".mixer").boundingBox()).toEqual(mixerBefore);
      await page.screenshot({ path: "test-results/add-audio-source.png" });
      await page.keyboard.press("Escape");
      await expect(sourceDialog).toHaveCount(0);
      await expect(addSource).toBeFocused();
      expect((await page.evaluate(() => window.acroClip.state())).preferences.audioSources).toHaveLength(2);
      const before = await page.evaluate(async () => JSON.stringify((await window.acroClip.state()).preferences));
      const width = page.getByRole("separator", { name: "Recording controls width" });
      await width.focus();
      await width.press("ArrowLeft");
      await expect(width).toHaveAttribute("aria-valuenow", "320");
      const handle = await width.boundingBox();
      if (!handle) throw new Error("Missing pane divider");
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
      await page.mouse.down();
      await page.mouse.move(handle.x - 60, handle.y + 100, { steps: 8 });
      await page.mouse.up();
      const persisted = await width.getAttribute("aria-valuenow");
      await page.reload();
      await expect(width).toHaveAttribute("aria-valuenow", persisted!);
      await width.press("Enter");
      const height = page.getByRole("separator", { name: "Recording lower panels height" });
      await height.focus();
      await height.press("ArrowUp");
      await expect(height).toHaveAttribute("aria-valuenow", "260");
      await expect.poll(async () => await page.evaluate(async () => JSON.stringify((await window.acroClip.state()).preferences))).toBe(before);
      await height.press("Enter");
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900));
      await expect
         .poll(() =>
            page.locator(".recording-page .segmented").evaluate((parent) => {
               const target = parent.querySelector("button.selected")!.getBoundingClientRect(),
                  marker = parent.querySelector(".selection-indicator")!.getBoundingClientRect();
               return Math.abs(target.x - marker.x) + Math.abs(target.width - marker.width);
            })
         )
         .toBeLessThan(2);
      await desktop.evaluate(({ BrowserWindow }) =>
         BrowserWindow.getAllWindows()[0]!.webContents.send("app-event", { type: "audio-levels", levels: { capture: 80, microphone: 0 } })
      );
      await expect(page.getByRole("meter", { name: "Source audio peak", exact: true })).toHaveAttribute("data-peak-visible", "true");
      await page.screenshot({ path: "test-results/recording-controls.png" });
      const regions = await page.evaluate(() =>
         Object.fromEntries(
            ["preview-surface", "mixer", "source-panel", "capture-actions"].map((name) => {
               const r = document.querySelector(`.${name}`)!.getBoundingClientRect();
               return [name, { x: r.x, y: r.y, bottom: r.bottom, height: r.height }];
            })
         )
      );
      expect(regions["source-panel"]!.bottom).toBeLessThan(regions["capture-actions"]!.y);
      expect(regions["mixer"]!.y).toBe(regions["capture-actions"]!.y);
      expect(regions["capture-actions"]!.height).toBeGreaterThanOrEqual(210);
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(980, 680));
      await page.screenshot({ path: "test-results/recording-controls-small.png" });
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const library = page.getByRole("separator", { name: "Library sidebar width" });
      await library.focus();
      await library.press("End");
      await expect(library).toHaveAttribute("aria-valuenow", "380");
      await library.press("Enter");
      await page.screenshot({ path: "test-results/library-controls-small.png" });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.getByRole("separator", { name: "Settings sidebar width" });
      await settings.focus();
      await settings.press("End");
      await page.getByRole("button", { name: "Custom", exact: true }).click();
      await selectOption(page, "Resolution limit", "720");
      const resolution = page.getByRole("combobox", { name: "Resolution limit" });
      await expect(resolution).toBeFocused();
      await expect(resolution).toHaveAttribute("data-value", "720");
      await resolution.press("ArrowDown");
      const popup = page.getByRole("listbox", { name: "Resolution limit" });
      const popupBox = await popup.boundingBox();
      if (!popupBox) throw new Error("Missing popup");
      expect(popupBox.x).toBeGreaterThanOrEqual(0);
      expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(980);
      expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(680);
      await page.waitForTimeout(180);
      await page.screenshot({ path: "test-results/settings-dropdown-small.png" });
      await page.keyboard.press("Escape");
      await expect(resolution).toBeFocused();
      await expect(popup).toHaveCount(0);
      await resolution.press("ArrowDown");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(resolution).toHaveText(/4K/);
      await selectOption(page, "Resolution limit", "720");
      await resolution.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(page.getByRole("combobox", { name: "Recording frame rate" })).toBeFocused();
      await expect(popup).toHaveCount(0);
      const compression = page.getByRole("spinbutton", { name: "Recording compression value" });
      await compression.fill("22");
      await compression.press("Enter");
      await expect(page.getByRole("slider", { name: "Recording compression", exact: true })).toHaveValue("22");
      await page.getByRole("slider", { name: "Recording compression", exact: true }).press("Delete");
      await expect(compression).toHaveValue("23");
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
         await page
            .locator(".slider-thumb")
            .last()
            .evaluate((node) => getComputedStyle(node).transitionProperty)
      ).toBe("none");
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
      await settings.press("Enter");
      await page.locator(".settings-scroll").evaluate((node) => {
         node.scrollTop = 0;
      });
      await page.screenshot({ path: "test-results/settings-controls-small.png" });
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: "Open Controls fixture", exact: true }).click();
      const viewer = page.getByRole("separator", { name: "Viewer sidebar width" });
      await viewer.focus();
      await viewer.press("End");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
      expect(await page.locator(".player-controls").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: "test-results/viewer-controls-small.png" });
      await viewer.press("Enter");
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 900));
      await page.screenshot({ path: "test-results/viewer-controls.png" });
   } finally {
      await desktop.close();
   }
});
