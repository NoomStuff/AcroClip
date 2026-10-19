import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";

test("the viewer rail retains its first clip, version and position when a newer clip arrives", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-viewer-state-"));
   const collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   const source = join(collection, "Reviewed moment.mp4");
   await promisify(execFile)(
      resolve("resources/media/ffmpeg.exe"),
      ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24", "-t", "5", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", source],
      { windowsHide: true }
   );
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         shareSizeMB: 1,
         shortcut: "Control+Alt+Shift+F11",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length).toBe(1);
      await page.getByRole("button", { name: "Clip viewer", exact: true }).click();
      await expect(page.locator(".viewer-title h1")).toHaveText("Reviewed moment");
      await page.getByRole("button", { name: "Create shareable", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.shareables.length).toBe(1);
      await page.getByRole("button", { name: "Shareable", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      await page.getByRole("slider", { name: "Playback position", exact: true }).fill("2");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      await copyFile(source, join(collection, "Newly saved moment.mp4"));
      await page.evaluate(() => window.acroClip.refresh());
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips[0]?.name).toBe("Newly saved moment");
      await expect(page.locator(".viewer-title h1")).toHaveText("Reviewed moment");
      await expect(page.getByRole("button", { name: "Shareable", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Original", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      await rm(source);
      await page.evaluate(() => window.acroClip.refresh());
      await expect(page.locator(".viewer-sidebar")).toContainText("Original missing or changed");
      await expect(page.getByRole("button", { name: "Original", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Shareable", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Open in AttaCut", exact: true })).toBeDisabled();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      // A stale playback request must not leave a global error over the player.
      await page.evaluate(async (path) => {
         await window.acroClip.playback(path).catch(() => undefined);
      }, source);
      await expect(page.locator(".toast.error")).toHaveCount(0);
      // Persistent action errors remain dismissible without blocking playback.
      await page.evaluate(async () => {
         await window.acroClip.renameClip("missing-clip", "Changed").catch(() => undefined);
      });
      await expect(page.locator(".toast.error")).toBeVisible();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(2.1);
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(page.locator(".toast.error")).toHaveCount(0);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(1.9);
      await page.getByRole("button", { name: "Library", exact: true }).first().click();
      await page.getByRole("button", { name: "Clip viewer", exact: true }).click();
      await expect(page.locator(".viewer-title h1")).toHaveText("Reviewed moment");
      await expect(page.getByRole("button", { name: "Shareable", exact: true })).toHaveAttribute("aria-pressed", "true");
   } finally {
      await desktop.close();
   }
});
