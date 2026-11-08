import { mediaTool } from "./media-tool";
import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";

// Two tones in separate tracks, so the test can hear which tracks play.
const twoTracks = [
   "-f",
   "lavfi",
   "-i",
   "testsrc2=size=640x360:rate=30",
   "-f",
   "lavfi",
   "-i",
   "sine=frequency=440:sample_rate=48000",
   "-f",
   "lavfi",
   "-i",
   "sine=frequency=1320:sample_rate=48000",
   "-t",
   "6",
   "-map",
   "0:v",
   "-map",
   "1:a",
   "-map",
   "2:a",
   "-metadata:s:a:0",
   "title=Master",
   "-metadata:s:a:1",
   "title=Microphone",
];

async function create(file: string, args: string[]) {
   await promisify(execFile)(mediaTool("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args, file], { windowsHide: true });
}

test("the player opens Matroska, QuickTime and converted formats, and switches audio tracks in place", async () => {
   test.setTimeout(120000);
   const profile = await realpath(await mkdtemp(join(tmpdir(), "acroclip-formats-ui-")));
   const collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   await create(join(collection, "Matroska moment.mkv"), [...twoTracks, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"]);
   await create(join(collection, "QuickTime moment.mov"), [...twoTracks.slice(0, 12), "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"]);
   await create(join(collection, "Converted moment.avi"), [...twoTracks, "-c:v", "mjpeg", "-q:v", "6", "-c:a", "pcm_s16le"]);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F7",
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).collectionStatus.phase, { timeout: 30000 }).toBe("ready");
      expect((await page.evaluate(() => window.acroClip.state())).clips).toHaveLength(3);
      const video = page.locator(".viewer-main video");
      const open = async (name: string) => {
         const previous = await video.evaluate((node: HTMLVideoElement) => node.currentSrc).catch(() => "");
         await page.getByRole("button", { name: "Library", exact: true }).first().click();
         await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
         await expect(page.locator(".viewer-title h1")).toHaveText(name);
         // A converted copy takes a moment, and the previous clip stays loaded meanwhile.
         await expect
            .poll(() => video.evaluate((node: HTMLVideoElement, before) => (node.currentSrc === before ? 0 : node.readyState), previous), { timeout: 60000 })
            .toBeGreaterThanOrEqual(2);
         expect(await video.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(640);
         const clip = (await page.evaluate(() => window.acroClip.state())).clips.find((item) => item.name === name)!;
         return { direct: (await video.evaluate((node: HTMLVideoElement) => node.currentSrc)) === clip.playbackUrl };
      };
      const audioDecoded = () =>
         video.evaluate((node: HTMLVideoElement) => (node as HTMLVideoElement & { webkitAudioDecodedByteCount: number }).webkitAudioDecodedByteCount);
      const enabledTracks = () =>
         video.evaluate((node: HTMLVideoElement) => {
            const tracks = (node as HTMLVideoElement & { audioTracks?: { length: number; [index: number]: { enabled: boolean } } }).audioTracks;
            return tracks ? Array.from({ length: tracks.length }, (_, index) => tracks[index]!.enabled) : [];
         });

      expect((await open("QuickTime moment")).direct, "QuickTime plays without a prepared copy").toBe(true);
      await expect(page.locator(".playback-error")).toHaveCount(0);

      for (const name of ["Matroska moment", "Converted moment"]) {
         expect((await open(name)).direct, `${name} ${name.startsWith("Converted") ? "plays from a copy" : "plays directly"}`).toBe(name === "Matroska moment");
         const source = await video.evaluate((node: HTMLVideoElement) => node.currentSrc);
         await expect.poll(enabledTracks).toEqual([true, false]);
         await page.getByRole("button", { name: "Play", exact: true }).click();
         const playing = async () => {
            await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused), { timeout: 60000 }).toBe(false);
            const decoded = await audioDecoded();
            await expect.poll(audioDecoded).toBeGreaterThan(decoded);
         };
         // Several tracks play as one mixed stream from a prepared copy.
         await selectOption(page, "Audio tracks", "2");
         await page.keyboard.press("Escape");
         await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentSrc), { timeout: 60000 }).not.toBe(source);
         await expect.poll(enabledTracks).toEqual([true]);
         await playing();
         // One track plays from the original element again, with that track enabled.
         await selectOption(page, "Audio tracks", "1");
         await page.keyboard.press("Escape");
         await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentSrc), { timeout: 60000 }).toBe(source);
         await expect.poll(enabledTracks).toEqual([false, true]);
         await playing();
         // Switching straight from one track to another never reloads the element.
         await video.evaluate((node: HTMLVideoElement) => {
            node.dataset["loads"] = "0";
            node.addEventListener("loadstart", () => (node.dataset["loads"] = String(Number(node.dataset["loads"]) + 1)));
         });
         await page.getByRole("combobox", { name: "Audio tracks", exact: true }).click();
         const options = page.getByRole("listbox", { name: "Audio tracks", exact: true }).getByRole("option");
         await options.filter({ hasText: "Master" }).click();
         await options.filter({ hasText: "Microphone" }).click();
         await page.keyboard.press("Escape");
         await expect.poll(enabledTracks).toEqual([true, false]);
         await playing();
         await page.waitForTimeout(600);
         expect(await video.evaluate((node: HTMLVideoElement) => [node.currentSrc, node.dataset["loads"]])).toEqual([source, "0"]);
         await page.getByRole("button", { name: "Pause", exact: true }).click();
      }
      await expect(page.locator(".playback-error")).toHaveCount(0);
   } finally {
      await desktop.close();
      await rm(profile, { recursive: true, force: true });
   }
});
