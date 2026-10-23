import { windowsDevExecutable } from "../../scripts/windows-dev-identity";
import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
test("Listen is one direct default-output toggle and survives gain changes without changing record mute", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires Windows audio capture");
   test.setTimeout(100000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-listen-ui-")),
      collection = join(profile, "clips"),
      title = `Listen tone ${Date.now()}`;
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         allowSoftwareEncoder: process.env["ACROCLIP_NATIVE_TEST_SOFTWARE"] === "1",
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         shortcut: "Control+Alt+Shift+F7",
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 30,
      })
   );
   const fixture = spawn(resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"), [title, "997"], {
      stdio: "ignore",
      env: { ...process.env, ACROCLIP_FIXTURE_LONG: "1" },
   });
   const executablePath = await windowsDevExecutable(process.cwd());
   const app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await app.firstWindow();
      await page.evaluate(() => {
         const events: unknown[] = [];
         (window as unknown as { listenEvents: unknown[] }).listenEvents = events;
         window.acroClip.onEvent((event) => {
            if (event.type === "visibility" || event.type === "audio-monitor" || event.type === "state")
               events.push({
                  at: performance.now(),
                  type: event.type,
                  visible: event.type === "visibility" ? event.visible : undefined,
                  monitorError: event.type === "audio-monitor" ? event.monitorError : undefined,
                  listeningError: event.type === "audio-monitor" ? event.listeningError : undefined,
                  recorder: event.type === "state" ? event.state.recorder : undefined,
               });
         });
      });
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.sources())).some((source) => source.name === title), { timeout: 20000 })
         .toBe(true);
      const target = (await page.evaluate(() => window.acroClip.sources())).find((source) => source.name === title)!;
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceId: id, captureAudio: true, captureMuted: true });
      }, target.id);
      await page.getByRole("button", { name: "Listen to Source audio", exact: true }).click();
      const listening = page.getByRole("button", { name: "Stop listening to Source audio", exact: true });
      try {
         await expect(listening).toHaveAttribute("aria-pressed", "true", { timeout: 20000 });
      } catch (error) {
         console.log("Listen startup events", JSON.stringify(await page.evaluate(() => (window as unknown as { listenEvents: unknown[] }).listenEvents)));
         throw error;
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
      for (const width of [1100, 900]) {
         await app.evaluate(({ BrowserWindow }, width) => {
            const window = BrowserWindow.getAllWindows()[0]!;
            window.setSize(width, 800);
         }, width);
         const geometry = await listening.evaluate((node) => {
            const button = node.getBoundingClientRect(),
               icon = node.querySelector("svg")!.getBoundingClientRect(),
               track = node.parentElement!.querySelector(".audio-db-track")!.getBoundingClientRect();
            return {
               width: button.width,
               height: button.height,
               iconWidth: icon.width,
               iconHeight: icon.height,
               vertical: Math.abs(icon.top + icon.height / 2 - track.top - track.height / 2),
               shrink: getComputedStyle(node).flexShrink,
            };
         });
         expect(geometry.width).toBe(30);
         expect(geometry.height).toBe(28);
         expect(geometry.iconWidth).toBe(18);
         expect(geometry.iconHeight).toBe(18);
         expect(geometry.vertical).toBeLessThan(1);
         expect(geometry.shrink).toBe("0");
      }
      await page.getByRole("textbox", { name: "Source audio level in decibels" }).fill("-6");
      await page.getByRole("textbox", { name: "Source audio level in decibels" }).press("Enter");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume).toBe(0.5);
      await expect(listening).toHaveAttribute("aria-pressed", "true");
      expect((await page.evaluate(() => window.acroClip.state())).preferences.captureMuted).toBe(true);
      await page.waitForTimeout(1200);
      await expect(listening).toHaveAttribute("aria-pressed", "true");
      await listening.click();
      await expect(page.getByRole("button", { name: "Listen to Source audio", exact: true })).toHaveAttribute("aria-pressed", "false");
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state, { timeout: 25000 }).toBe("recording");
      await page.getByRole("button", { name: "Listen to Source audio", exact: true }).click();
      await expect(listening).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: "Recording", exact: true }).click();
      await expect(page.getByRole("button", { name: "Listen to Source audio", exact: true })).toHaveAttribute("aria-pressed", "false");
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Resolution limit", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Sharing", exact: true }).click();
      await expect(page.getByRole("spinbutton", { name: "Default shareable size in MB", exact: true })).toBeEnabled();
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("recording");
      await page.evaluate(() => window.acroClip.stopRecording());
   } finally {
      await app.close();
      fixture.kill();
   }
});
