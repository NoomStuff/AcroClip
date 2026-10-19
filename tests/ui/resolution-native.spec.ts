import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultPreferences } from "../../src/shared/defaults";
import { fitResolutionLimit } from "../../src/shared/recording-presets";
test("screen resolution limits preserve the real source aspect without upscaling", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires real Windows recording");
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-screen-limit-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         sourceKind: "screen",
         captureAudio: false,
         quality: "custom",
         customFPS: 30,
         clipSeconds: 5,
         shortcut: "Control+Alt+Shift+F1",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      const display = await app.evaluate(async ({ BrowserWindow, screen }) => {
         const display = screen.getPrimaryDisplay();
         const fixture = new BrowserWindow({ ...display.bounds, frame: false, show: false, alwaysOnTop: true, backgroundColor: "#2255aa" });
         await fixture.loadURL("data:text/html,<title>Controlled screen limit fixture</title><body style='margin:0;background:%232255aa'></body>");
         fixture.show();
         fixture.setBounds(display.bounds);
         return String(display.id);
      });
      const source = (await page.evaluate(() => window.acroClip.sources())).find((item) => item.kind === "screen" && item.displayId === display)!;
      expect(source).toBeDefined();
      const sizes: Array<{ width: number; height: number }> = [];
      for (const limit of [0, 720]) {
         await page.evaluate(
            async ({ id, limit }) => {
               const state = await window.acroClip.state();
               await window.acroClip.savePreferences({ ...state.preferences, sourceId: id, resolutionLimit: limit });
               await window.acroClip.startRecording();
            },
            { id: source.id, limit }
         );
         await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 30000 }).toBeGreaterThan(1.5);
         await page.evaluate(() => window.acroClip.saveClip());
         await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 25000 }).toBe(sizes.length + 1);
         const clip = (await page.evaluate(() => window.acroClip.state())).clips[0]!;
         sizes.push({ width: clip.width, height: clip.height });
         const decode = spawnSync(resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", clip.path, "-f", "null", "-"], {
            encoding: "utf8",
            windowsHide: true,
         });
         expect(decode.status, decode.stderr).toBe(0);
         await page.evaluate(() => window.acroClip.stopRecording());
      }
      expect(sizes[1]).toEqual(fitResolutionLimit(sizes[0]!, 720));
      console.log("Actual screen Original and 720p limit", JSON.stringify(sizes));
   } finally {
      await app.close();
   }
});
