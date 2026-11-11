import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
import { mediaTool } from "./media-tool";

test("a clip trims from the library as a copy and from the player in place", async () => {
   const testInfo = test.info();
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-trim-flow-"));
   const collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   const source = join(collection, "Trim moment.mp4");
   // Like a recording: a keyframe every second, two named audio tracks.
   await promisify(execFile)(
      mediaTool("ffmpeg"),
      [
         "-v",
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
         "sine=frequency=660:sample_rate=48000",
         "-t",
         "10",
         "-map",
         "0",
         "-map",
         "1",
         "-map",
         "2",
         "-c:v",
         "libx264",
         "-preset",
         "ultrafast",
         "-bf",
         "0",
         "-g",
         "30",
         "-sc_threshold",
         "0",
         "-pix_fmt",
         "yuv420p",
         "-c:a",
         "aac",
         "-metadata:s:a:0",
         "title=Game",
         "-metadata:s:a:1",
         "title=Microphone",
         source,
      ],
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
         shortcut: "Control+Alt+Shift+F11",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   const clips = async () => (await desktop.firstWindow().then((page) => page.evaluate(() => window.acroClip.state()))).clips;
   try {
      const page = await desktop.firstWindow();
      await expect.poll(async () => (await clips()).length).toBe(1);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: "Actions for Trim moment", exact: true }).click();
      await page.getByRole("menuitem", { name: "Trim clip", exact: true }).click();
      // The player opens with the whole clip kept, so there's nothing to save yet.
      const start = page.getByRole("slider", { name: "Trim start", exact: true });
      const end = page.getByRole("slider", { name: "Trim end", exact: true });
      await expect(start).toBeVisible();
      await expect(page.locator(".viewer-title h1")).toHaveText("Trim moment");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(2);
      const save = page.getByRole("button", { name: "Save as copy", exact: true });
      await expect(save).toBeDisabled();
      // Shift moves a handle a second, arrows a frame. The player shows the frame under the handle.
      await start.focus();
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await expect(start).toHaveAttribute("aria-valuetext", "0:02.0");
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(2, 1);
      await end.focus();
      for (let press = 0; press < 3; press++) await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("ArrowRight");
      await expect(end).toHaveAttribute("aria-valuetext", "0:07.0");
      // The handles can't cross.
      await start.focus();
      await page.keyboard.press("End");
      await expect(start).toHaveAttribute("aria-valuetext", "0:06.9");
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+ArrowRight");
      await page.keyboard.press("Shift+ArrowRight");
      await page.locator(".player-controls").screenshot({ path: testInfo.outputPath("trim-player.png") });
      // Trimming swaps the sidebar's file buttons for its own.
      await expect(page.getByRole("button", { name: "Show clip in folder", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Copy clip", exact: true })).toHaveCount(0);
      // The playhead moves through the same path as a drag and stays between the handles.
      // A pointer drag here depended on hitting the playhead's dot mid-glide, which flaked under Xvfb.
      const playhead = page.getByRole("slider", { name: "Playback position", exact: true });
      await playhead.focus();
      await page.keyboard.press("End");
      await expect(start).toHaveAttribute("aria-valuetext", "0:02.0");
      // The end handle is a frame past 7 seconds, so the last kept frame is just past 7 too.
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(7);
      expect(await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(7.05);
      // Trimming keeps this clip open, and playback plays the kept part, stopping on its last frame.
      await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      // Playing from the end handle starts over at the start handle.
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime < 3)).toBe(true);
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.paused), { timeout: 15000 }).toBe(true);
      const stopped = await page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.currentTime);
      expect(stopped).toBeGreaterThan(6.95);
      expect(stopped).toBeLessThan(7.05);

      await save.click();
      await expect.poll(async () => (await clips()).length, { timeout: 30000 }).toBe(2);
      await expect(page.locator(".viewer-title h1")).toHaveText("Trim moment (Trim)");
      await expect(start).toHaveCount(0);
      const copy = (await clips()).find((clip) => clip.name === "Trim moment (Trim)");
      await expect(page.getByRole("button", { name: "Copy clip", exact: true })).toBeEnabled();
      expect(copy?.duration).toBeCloseTo(5, 1);
      expect(copy?.tracks.map((track) => track.title)).toEqual(["Game", "Microphone"]);
      expect((await clips()).find((clip) => clip.name === "Trim moment")?.duration).toBeCloseTo(10, 1);

      // From the player's sidebar: trim the copy again, saving over it. Escape and Cancel leave the clip as it is.
      const trimButton = page.getByRole("button", { name: "Trim clip", exact: true });
      await trimButton.click();
      await expect(start).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(start).toHaveCount(0);
      await trimButton.click();
      await page.getByRole("button", { name: "Cancel trim", exact: true }).click();
      await expect(start).toHaveCount(0);
      await trimButton.click();
      await end.focus();
      await page.keyboard.press("Shift+ArrowLeft");
      await page.getByRole("combobox", { name: "Save options: Save as copy", exact: true }).click();
      await page.getByRole("option", { name: "Save", exact: true }).click();
      await page.locator(".viewer-sidebar-bottom").screenshot({ path: testInfo.outputPath("trim-actions.png") });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await clips()).find((clip) => clip.id === copy?.id)?.duration, { timeout: 30000 }).toBeLessThan(4.1);
      await expect(start).toHaveCount(0);
      expect((await clips()).length).toBe(2);
      // The player reloads the replaced file instead of the footage it had loaded.
      await expect.poll(() => page.locator(".viewer-main video").evaluate((node: HTMLVideoElement) => node.duration)).toBeLessThan(4.1);
      expect((await readdir(collection)).filter((name) => name.startsWith(".acroclip-trim-"))).toEqual([]);
   } finally {
      await desktop.close();
   }
});
