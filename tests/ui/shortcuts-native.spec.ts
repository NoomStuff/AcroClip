import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultPreferences } from "../../src/shared/defaults";
test("configured global capture keys work in the tray with a controlled application target", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires actual Windows capture and global key input");
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-shortcuts-native-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   const recordKey = "Control+Alt+Shift+F4",
      saveKey = "Control+Alt+Shift+F5";
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         microphone: false,
         shortcut: saveKey,
         shortcuts: { toggleRecording: recordKey },
         clipSeconds: 5,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 30,
         notifications: "off",
         sound: false,
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   const press = async (key: number) => {
      await promisify(execFile)(
         "powershell.exe",
         [
            "-NoProfile",
            "-Command",
            `Add-Type 'using System.Runtime.InteropServices; public class ClipKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,int flags,int extra); }'; foreach($key in @(17,18,16,${key})){[ClipKey]::keybd_event($key,0,0,0)}; foreach($key in @(${key},16,18,17)){[ClipKey]::keybd_event($key,0,2,0)}`,
         ],
         { windowsHide: true }
      );
   };
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible({ timeout: 15000 });
      await app.evaluate(async ({ BrowserWindow }) => {
         const fixture = new BrowserWindow({ title: "Global shortcut capture fixture", width: 640, height: 360, webPreferences: { sandbox: true } });
         await fixture.loadURL(
            'data:text/html,<title>Global shortcut capture fixture</title><body style="margin:0;background:rgb(20,90,200)">Controlled capture target'
         );
         fixture.showInactive();
      });
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.sources())).some((item) => item.name === "Global shortcut capture fixture"), {
            timeout: 15000,
         })
         .toBe(true);
      const source = (await page.evaluate(() => window.acroClip.sources())).find((item) => item.name === "Global shortcut capture fixture")!;
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceId: id });
      }, source.id);
      expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), recordKey)).toBe(true);
      expect(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), saveKey)).toBe(true);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.evaluate(() => window.acroClip.window("close"));
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).windowVisible).toBe(false);
      await press(115);
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state, { timeout: 25000 }).toBe("recording");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 25000 }).toBeGreaterThan(2);
      expect((await page.evaluate(() => window.acroClip.state())).recorder.sourceId?.split(":")[1]).toBe(source.id.split(":")[1]);
      await press(116);
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 25000 }).toBe(1);
      const file = (await page.evaluate(() => window.acroClip.state())).clips[0]!.path;
      await press(115);
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
      await promisify(execFile)(resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", file, "-f", "null", "-"], { windowsHide: true });
      // The bundled ffmpeg has no rawvideo encoder, so one PNG frame goes through
      // image2pipe and nativeImage turns it back into channel values.
      const frame = await promisify(execFile)(
         resolve("resources/media/ffmpeg.exe"),
         ["-v", "error", "-ss", "0.5", "-i", file, "-vf", "crop=2:2:iw/2:ih/2", "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "-"],
         { windowsHide: true, encoding: "buffer" }
      );
      const pixel = await app.evaluate(({ nativeImage }, encoded) => {
         const data = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).toBitmap();
         return [data[2]!, data[1]!, data[0]!];
      }, frame.stdout.toString("base64"));
      expect(pixel[0]).toBeLessThan(60);
      expect(pixel[1]).toBeGreaterThan(60);
      expect(pixel[1]).toBeLessThan(120);
      expect(pixel[2]).toBeGreaterThan(150);
   } finally {
      await app
         .firstWindow()
         .then((page) => page.evaluate(() => window.acroClip.stopRecording()))
         .catch(() => undefined);
      await app.close();
   }
});
