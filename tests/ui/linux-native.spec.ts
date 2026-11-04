import { test, expect, _electron as electron } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mediaTool } from "./media-tool";
import { defaultPreferences } from "../../src/shared/defaults";

test("Linux native decorations, exact application capture and source loss", async () => {
   test.skip(process.platform !== "linux" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires the private Linux recorder fixture");
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-linux-native-ui-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSourcesVersion: undefined,
         audioSources: [],
         allowSoftwareEncoder: process.env["ACROCLIP_TEST_HARDWARE"] !== "1",
         captureAudio: false,
         microphone: false,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 24,
         clipSeconds: 5,
         notificationStartBanner: false,
         notificationStartSound: false,
         notificationStopBanner: false,
         notificationStopSound: false,
         notificationSaveBanner: false,
         notificationSaveSound: false,
         notificationErrorBanner: true as const,
         notificationErrorSound: false,
      })
   );
   const title = `AcroClip Linux blue fixture ${Date.now()}`;
   const fixture = spawn("ffplay", ["-v", "error", "-f", "lavfi", "-i", "color=blue:size=320x180:rate=30", "-window_title", title, "-an"], { stdio: "ignore" });
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   let cover: ReturnType<typeof spawn> | undefined;
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible();
      await expect(page.locator(".window-controls")).toHaveCount(0);
      const geometry = await app.evaluate(({ BrowserWindow, screen }) => ({
         bounds: BrowserWindow.getAllWindows()[0]!.getBounds(),
         workArea: screen.getPrimaryDisplay().workArea,
      }));
      expect(geometry.bounds.width).toBeLessThanOrEqual(geometry.workArea.width);
      expect(geometry.bounds.height).toBeLessThanOrEqual(geometry.workArea.height);
      expect(await page.locator(".titlebar").evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region"))).toBe("no-drag");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.sources())).some((source) => source.name === title)).toBe(true);
      const sources = await page.evaluate(() => window.acroClip.sources());
      expect(sources.some((source) => source.name === "AcroClip")).toBe(false);
      const source = sources.find((source) => source.name === title)!;
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "app", sourceId: id });
      }, source.id);
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      cover = spawn(
         "ffplay",
         ["-v", "error", "-f", "lavfi", "-i", "color=red:size=1600x1000:rate=30", "-window_title", "Unrelated red cover", "-fs", "-alwaysontop", "-an"],
         { stdio: "ignore" }
      );
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 25000 }).toBeGreaterThan(2);
      await page.getByRole("button", { name: "Save clip", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 25000 }).toBe(1);
      const clip = (await page.evaluate(() => window.acroClip.state())).clips[0]!;
      await promisify(execFile)("ffmpeg", ["-v", "error", "-i", clip.path, "-f", "null", "-"]);
      const frame = await promisify(execFile)(
         "ffmpeg",
         ["-v", "error", "-ss", "0.5", "-i", clip.path, "-vf", "crop=2:2:iw/2:ih/2", "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
         { encoding: "buffer" }
      );
      expect(frame.stdout[2]).toBeGreaterThan(180);
      expect(frame.stdout[0]).toBeLessThan(40);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: `Open ${clip.name}`, exact: true }).click();
      const video = page.locator(".viewer-main video");
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await video.evaluate(async (element: HTMLVideoElement) => {
         await new Promise<void>((done) => {
            element.addEventListener("seeked", () => done(), { once: true });
            element.currentTime = element.duration / 2;
         });
      });
      await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeDisabled();
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
      const folder = await page.evaluate(() => window.acroClip.createFolder("", "Saved captures"));
      await page.evaluate(({ id, folder }) => window.acroClip.moveClip(id, folder), { id: clip.id, folder });
      await page.evaluate(() => window.acroClip.refresh());
      expect((await page.evaluate(() => window.acroClip.state())).clips.find((item) => item.id === clip.id)?.path).toContain("Saved captures");
      fixture.kill();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state, { timeout: 15000 }).toBe("waiting");
      await page.evaluate(() => window.acroClip.stopRecording());
      const exited = new Promise<void>((done) => app.once("close", () => done()));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
      await exited;
   } finally {
      fixture.kill();
      cover?.kill();
      await app.close().catch(() => undefined);
   }
});

test("Linux recording saves the requested footage during a first library scan", async () => {
   test.skip(process.platform !== "linux" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires the private Linux recorder fixture");
   test.setTimeout(180000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-linux-cold-scan-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   const seed = join(profile, "seed.mp4");
   await promisify(execFile)(mediaTool("ffmpeg"), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      seed,
   ]);
   for (let index = 0; index < 600; index++) await copyFile(seed, join(collection, `Imported ${index}.mp4`));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSourcesVersion: 2,
         audioSources: [],
         allowSoftwareEncoder: process.env["ACROCLIP_TEST_HARDWARE"] !== "1",
         captureAudio: false,
         microphone: false,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 24,
         clipSeconds: 5,
         notificationStartBanner: false,
         notificationStartSound: false,
         notificationStopBanner: false,
         notificationStopSound: false,
         notificationSaveBanner: false,
         notificationSaveSound: false,
         notificationErrorBanner: true as const,
         notificationErrorSound: false,
      })
   );
   const app = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox", `--force-device-scale-factor=${process.env["ACROCLIP_TEST_SCALE_FACTOR"] ?? "1.25"}`],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible();
      expect(["loading", "refreshing"]).toContain((await page.evaluate(() => window.acroClip.state())).collectionStatus.phase);
      const source = (await page.evaluate(() => window.acroClip.sources())).find((item) => item.kind === "screen")!;
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "screen", sourceId: id });
      }, source.id);
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 20000 }).toBeGreaterThan(1);
      await page.getByRole("button", { name: "Save clip", exact: true }).click();
      await expect
         .poll(async () => (await readdir(collection, { recursive: true })).some((file) => file.endsWith(".mkv") && !file.endsWith(".saving.mkv")), {
            timeout: 15000,
         })
         .toBe(true);
      expect(["loading", "refreshing"]).toContain((await page.evaluate(() => window.acroClip.state())).collectionStatus.phase);
      await promisify(execFile)(app.process().spawnfile, ["--no-sandbox", "--disable-gpu-sandbox", resolve("."), "--clip"], {
         env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
      });
      await expect
         .poll(async () => (await readdir(collection, { recursive: true })).filter((file) => file.endsWith(".mkv") && !file.endsWith(".saving.mkv")).length, {
            timeout: 15000,
         })
         .toBe(2);
      expect(["loading", "refreshing"]).toContain((await page.evaluate(() => window.acroClip.state())).collectionStatus.phase);
      await page.getByRole("button", { name: "Stop recording", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 120000 }).toBe(602);
      const file = (await readdir(collection, { recursive: true })).find((file) => file.endsWith(".mkv") && !file.endsWith(".saving.mkv"))!;
      await promisify(execFile)(mediaTool("ffmpeg"), ["-v", "error", "-i", join(collection, file), "-f", "null", "-"]);
   } finally {
      await app
         .firstWindow()
         .then((page) => page.evaluate(() => window.acroClip.stopRecording()))
         .catch(() => undefined);
      await app.close();
   }
});
