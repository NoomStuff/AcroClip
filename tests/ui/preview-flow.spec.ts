import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

declare global {
   interface Window {
      releasePreview?: () => void;
      firstPreviewReveal?: { from: number; to: number; duration: number };
   }
}

test("live preview captures the chosen window and releases tracks on navigation, source changes, and hiding", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-preview-ui-"));
   const collection = join(profile, "clips");
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
         captureAudio: false,
         shortcut: "Control+Alt+Shift+F12",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await desktop.evaluate(async ({ BrowserWindow }) => {
         for (const [name, color] of [
            ["Preview fixture A", "#e44c66"],
            ["Preview fixture B", "#41b8aa"],
         ] as const) {
            const fixture = new BrowserWindow({
               title: name,
               width: 640,
               height: 360,
               x: name.endsWith("A") ? 50 : 740,
               y: 50,
               webPreferences: { sandbox: true },
            });
            await fixture.loadURL(
               `data:text/html,${encodeURIComponent(`<html><head><title>${name}</title></head><body style="margin:0;background:${color};font:30px sans-serif;color:white"><div style="padding:50px">${name}<div id="frame"></div></div><script>let count=0;setInterval(()=>{document.querySelector('#frame').textContent=++count;document.body.style.background=count%2?'${color}':'#503c99'},120)</script></body></html>`)}`
            );
            fixture.showInactive();
         }
      });
      // Window creation can finish before the compositor exposes the second window.
      await desktop.evaluate(async ({ BrowserWindow }) => {
         for (const name of ["Hidden capture fixture", "Protected capture fixture"]) {
            const fixture = new BrowserWindow({ title: name, width: 320, height: 200, show: false, webPreferences: { sandbox: true } });
            await fixture.loadURL(`data:text/html,<title>${name}</title><body>Controlled fixture`);
            if (name.startsWith("Protected")) {
               fixture.setContentProtection(true);
               fixture.showInactive();
            }
         }
      });
      await expect
         .poll(
            async () => {
               const visible = await page.evaluate(() => window.acroClip.sources());
               return ["Preview fixture A", "Preview fixture B"].every((name) => visible.some((source) => source.name === name));
            },
            { timeout: 15000 }
         )
         .toBe(true);
      const choices = await page.evaluate(() => window.acroClip.sources());
      const sourceA = choices.find((source) => source.name === "Preview fixture A");
      const sourceB = choices.find((source) => source.name === "Preview fixture B");
      expect(choices.some((source) => source.name === "Hidden capture fixture")).toBe(false);
      if (process.platform === "win32" || process.platform === "darwin")
         expect(choices.some((source) => source.name === "Protected capture fixture")).toBe(false);
      expect(sourceA).toBeDefined();
      expect(sourceB).toBeDefined();
      // Delay permission acquisition, but still capture a real window when released.
      const holdPreview = () =>
         page.evaluate(() => {
            const acquire = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            const gate = new Promise<void>((resolve) => {
               window.releasePreview = resolve;
            });
            navigator.mediaDevices.getDisplayMedia = async (options) => {
               navigator.mediaDevices.getDisplayMedia = acquire;
               await gate;
               return acquire(options);
            };
         });
      const releasePreview = () => page.evaluate(() => window.releasePreview?.());
      await holdPreview();
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "app", sourceId: id });
      }, sourceA!.id);
      const preview = page.locator(".preview-stream");
      await expect(page.getByRole("status", { name: "Loading preview" })).toBeVisible();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "connecting");
      await expect(page.locator(".preview-loading-spinner")).toHaveCount(0);
      const icon = page.locator(".preview-placeholder");
      const initialOpacity = await icon.evaluate((node) => {
         const pulse = node.getAnimations().find((animation) => animation instanceof CSSAnimation && animation.animationName === "preview-icon-pulse")!;
         pulse.pause();
         pulse.currentTime = 1000;
         return Number(getComputedStyle(node).opacity);
      });
      await icon.evaluate((node) => {
         node.getAnimations().find((animation) => animation instanceof CSSAnimation && animation.animationName === "preview-icon-pulse")!.currentTime = 1750;
      });
      expect(await icon.evaluate((node) => Number(getComputedStyle(node).opacity))).toBeLessThan(initialOpacity);
      await expect(page.locator(".preview-message")).toHaveCount(0);
      await preview.evaluate((node) => {
         const observer = new MutationObserver(() => {
            if (!node.classList.contains("ready")) return;
            const animation = node.getAnimations()[0];
            if (!animation) return;
            const frames = (animation.effect as KeyframeEffect).getKeyframes();
            window.firstPreviewReveal = {
               from: Number(frames[0]?.["opacity"]),
               to: Number(frames.at(-1)?.["opacity"]),
               duration: Number(animation.effect?.getTiming().duration),
            };
            observer.disconnect();
         });
         observer.observe(node, { attributes: true, attributeFilter: ["class"] });
      });
      await releasePreview();
      const initialRequestedAt = performance.now();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      expect(await page.evaluate(() => window.firstPreviewReveal)).toEqual({ from: 0, to: 1, duration: 140 });
      console.log("Preview initial first frame ms", Math.round(performance.now() - initialRequestedAt));
      const first = await preview.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames);
      await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(first + 5);
      const snapshot = async () =>
         preview.evaluate((video: HTMLVideoElement) => {
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = 90;
            canvas.getContext("2d")!.drawImage(video, 0, 0, 160, 90);
            return canvas.toDataURL();
         });
      const firstImage = await snapshot();
      await expect.poll(snapshot).not.toBe(firstImage);
      await expect(preview).toHaveAttribute("aria-label", "Live preview of Preview fixture A");
      const tracks = await preview.evaluate((video: HTMLVideoElement) => {
         const stream = video.srcObject as MediaStream;
         (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview = stream.getTracks();
         return stream.getTracks().map((track) => ({ kind: track.kind, state: track.readyState, settings: track.getSettings() }));
      });
      expect(tracks).toHaveLength(1);
      expect(tracks[0]).toMatchObject({ kind: "video", state: "live" });
      expect(tracks[0]?.settings.frameRate).toBeLessThanOrEqual(15);
      expect(tracks[0]?.settings.width).toBeLessThanOrEqual(960);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect
         .poll(() => page.evaluate(() => (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview.map((track) => track.readyState)))
         .toEqual(["ended"]);
      await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => video.srcObject === null)).toBe(true);
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      const cachedA = await page.locator(".preview-still").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
      await page.evaluate(() => {
         (window as unknown as { cacheShown: boolean }).cacheShown = false;
         (window as unknown as { handoffShown: boolean }).handoffShown = false;
         const root = document.querySelector(".recording-page")!;
         const observer = new MutationObserver(() => {
            if (root.getClientRects().length && root.querySelector(".preview-still.cached")) (window as unknown as { cacheShown: boolean }).cacheShown = true;
            if (root.querySelector(".preview-stream.ready") && root.querySelector(".preview-still.cached"))
               (window as unknown as { handoffShown: boolean }).handoffShown = true;
         });
         observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
      });
      await holdPreview();
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await expect(page.getByRole("status", { name: "Loading preview" })).toBeVisible();
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      expect(await page.locator(".preview-still").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(cachedA);
      await expect(page.locator(".preview-message")).toHaveCount(0);
      await releasePreview();
      const returnRequestedAt = performance.now();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      await expect(page.locator(".preview-still")).not.toHaveClass(/cached/);
      console.log("Preview tab return first frame ms", Math.round(performance.now() - returnRequestedAt));
      expect(await page.evaluate(() => (window as unknown as { cacheShown: boolean }).cacheShown)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { handoffShown: boolean }).handoffShown)).toBe(true);
      await preview.evaluate((video: HTMLVideoElement) => {
         (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview = (video.srcObject as MediaStream).getTracks();
      });
      await holdPreview();
      const outgoing = page.locator(".preview-outgoing");
      await outgoing.evaluate((node) => {
         const observer = new MutationObserver(() => {
            const fade = node.getAnimations()[0];
            if (!fade) return;
            fade.pause();
            fade.currentTime = 90;
            observer.disconnect();
         });
         observer.observe(node, { attributes: true, attributeFilter: ["style", "width", "height"] });
      });
      await page.locator(".source-row").filter({ hasText: "Preview fixture B" }).click();
      await expect(preview).toHaveAttribute("aria-label", "Live preview of Preview fixture B");
      const departing = await outgoing.evaluate((node: HTMLCanvasElement) => ({
         width: node.width,
         opacity: Number(getComputedStyle(node).opacity),
         layer: Number(getComputedStyle(node).zIndex),
         iconLayer: Number(getComputedStyle(document.querySelector(".preview-loading")!).zIndex),
         incomingLayer: Number(getComputedStyle(document.querySelector(".preview-stream")!).zIndex),
      }));
      expect(departing.width).toBeGreaterThan(200);
      expect(departing.opacity).toBeGreaterThan(0);
      expect(departing.opacity).toBeLessThan(1);
      expect(departing.layer).toBeGreaterThan(departing.iconLayer);
      expect(departing.layer).toBeLessThan(departing.incomingLayer);
      await outgoing.evaluate((node) => node.getAnimations()[0]!.finish());
      await expect(outgoing).toHaveCSS("opacity", "0");
      await releasePreview();
      const switchRequestedAt = performance.now();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      console.log("Preview source switch first frame ms", Math.round(performance.now() - switchRequestedAt));
      await expect
         .poll(() => page.evaluate(() => (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview.map((track) => track.readyState)))
         .toEqual(["ended"]);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      const cachedB = await page.locator(".preview-still").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      // Returning to A must restore A's frame, rather than B's frame or a blank canvas.
      await holdPreview();
      await page.locator(".source-row").filter({ hasText: "Preview fixture A" }).click();
      await expect(page.getByRole("status", { name: "Loading preview" })).toBeVisible();
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      expect(await page.locator(".preview-still").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(cachedB);
      await releasePreview();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      await preview.evaluate((video: HTMLVideoElement) => {
         (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview = (video.srcObject as MediaStream).getTracks();
      });
      await page.evaluate(() => window.acroClip.window("minimize"));
      await expect
         .poll(() => page.evaluate(() => (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview.map((track) => track.readyState)))
         .toEqual(["ended"]);
      await holdPreview();
      await desktop.evaluate(({ BrowserWindow }) => {
         const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === "AcroClip");
         main?.restore();
         main?.show();
      });
      await expect(page.getByRole("status", { name: "Loading preview" })).toBeVisible();
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      await expect(page.locator(".preview-message")).toHaveCount(0);
      await releasePreview();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      // Rapid requests must not let an older completion revoke the final source.
      await page.evaluate(
         async ({ a, b }) => {
            for (const id of [a, b, a, b]) {
               const state = await window.acroClip.state();
               await window.acroClip.savePreferences({ ...state.preferences, sourceId: id });
               await new Promise((resolve) => setTimeout(resolve, 35));
            }
         },
         { a: sourceA!.id, b: sourceB!.id }
      );
      await expect(preview).toHaveAttribute("aria-label", "Live preview of Preview fixture B");
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      // A failed reconnect must expose the error and retry action, even after a cached frame.
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".preview-still")).toHaveClass(/cached/);
      await page.evaluate(() => {
         const acquire = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
         navigator.mediaDevices.getDisplayMedia = async () => {
            navigator.mediaDevices.getDisplayMedia = acquire;
            throw new DOMException("Source temporarily unreadable", "NotReadableError");
         };
      });
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Preview unavailable", exact: true })).toBeVisible();
      await expect(page.locator(".preview-still")).not.toHaveClass(/cached/);
      await page.getByRole("button", { name: "Retry preview", exact: true }).click();
      await expect(page.locator(".preview-surface")).toHaveAttribute("data-preview", "live");
      await page.waitForTimeout(300);
      await preview.evaluate((video: HTMLVideoElement) => {
         (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview = (video.srcObject as MediaStream).getTracks();
      });
      await desktop.evaluate(({ BrowserWindow }) =>
         BrowserWindow.getAllWindows()
            .find((window) => window.getTitle() === "AcroClip")!
            .hide()
      );
      await expect
         .poll(() => page.evaluate(() => (window as unknown as { previousPreview: MediaStreamTrack[] }).previousPreview.map((track) => track.readyState)))
         .toEqual(["ended"]);
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
   } finally {
      await desktop.evaluate(({ BrowserWindow }) => {
         for (const window of BrowserWindow.getAllWindows()) {
            if (window.getTitle() !== "AcroClip") window.destroy();
            else {
               window.restore();
               window.show();
            }
         }
      });
      await desktop.close();
   }
});
