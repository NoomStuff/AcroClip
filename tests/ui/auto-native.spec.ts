import { windowsDevExecutable } from "../../scripts/windows-dev-identity";
import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("Auto waits privately, adds a local game and follows it without losing accepted clips", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires actual Windows capture");
   test.setTimeout(100_000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-auto-native-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   const title = `Clip detector fixture ${Date.now()}`;
   const action = join(profile, "focus.txt");
   const handle = join(profile, "handle.txt");
   const script = join(profile, "fixture.ps1");
   const quoted = (value: string) => value.replaceAll("'", "''");
   await writeFile(
      script,
      `
Add-Type -AssemblyName System.Windows.Forms
Add-Type 'using System; using System.Runtime.InteropServices; public class FocusFixture { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command); }'
$form = New-Object System.Windows.Forms.Form
$form.Text = '${quoted(title)}'
$form.ClientSize = New-Object System.Drawing.Size(640,360)
$form.BackColor = [System.Drawing.Color]::DodgerBlue
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
 if (Test-Path -LiteralPath '${quoted(action)}') {
  $command = Get-Content -LiteralPath '${quoted(action)}' -Raw
  Remove-Item -LiteralPath '${quoted(action)}'
  if ($command -eq 'focus') { $form.WindowState = 'Normal'; $form.Activate(); [FocusFixture]::SetForegroundWindow($form.Handle) | Out-Null }
  if ($command -eq 'exit') { $form.Close() }
 }
})
$form.Add_Shown({ [FocusFixture]::ShowWindow($form.Handle,5) | Out-Null; [System.IO.File]::WriteAllText('${quoted(handle)}', $form.Handle.ToInt64().ToString()); $timer.Start() })
[System.Windows.Forms.Application]::Run($form)
$timer.Dispose()
$form.Dispose()
`
   );
   const fixture = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", script], { windowsHide: true, stdio: "ignore" });
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
         sourceKind: "auto",
         shortcut: "Control+Alt+Shift+F4",
         clipSeconds: 5,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 24,
         captureAudio: false,
      })
   );
   await writeFile(
      join(profile, "game-catalog.json"),
      JSON.stringify({
         updated: Date.now(),
         entries: [{ id: "fixture-unrelated", name: "Unrelated fixture", executables: [{ name: "never-running-fixture.exe", os: process.platform }] }],
      })
   );
   const executablePath = await windowsDevExecutable(process.cwd());
   const desktop = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
   });
   try {
      await expect
         .poll(async () => {
            try {
               return await readFile(handle, "utf8");
            } catch {
               return "";
            }
         })
         .not.toBe("");
      const page = await desktop.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible({ timeout: 15000 });
      console.log("Auto fixture and app opened");
      await expect(page.getByRole("button", { name: "Start recording", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      console.log("Auto recording start requested");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state, { timeout: 30_000 }).toBe("waiting");
      expect((await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds).toBe(0);
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Search games", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      console.log("Auto waiting state confirmed");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.games())).some((game) => game.name === title)).toBe(true);
      const candidate = (await page.evaluate(() => window.acroClip.games())).find((game) => game.name === title)!;
      await selectOption(page, "Running application", candidate.id);
      await page.getByRole("button", { name: "Add selected game", exact: true }).click();
      await page.locator(".rail").getByRole("button", { name: "Recording", exact: true }).click();
      console.log("Local fixture game added");
      await writeFile(action, "focus");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.sourceId, { timeout: 20_000 }).toBe(candidate.id);
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 15_000 }).toBeGreaterThan(3);
      await expect(page.locator(".detected-game")).toContainText(title);
      await expect(page.locator(".detected-game img")).toHaveCount(1);
      await page.screenshot({ path: "test-results/auto-detected-game.png" });
      await desktop.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows().find((item) => item.getTitle() === "AcroClip");
         window?.show();
         window?.focus();
      });
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.waitForTimeout(1500);
      expect((await page.evaluate(() => window.acroClip.state())).recorder.sourceId).toBe(candidate.id);
      await desktop.evaluate(({ BrowserWindow }) => {
         BrowserWindow.getAllWindows()
            .find((item) => item.getTitle() === "AcroClip")
            ?.hide();
      });
      const second = spawn(resolve("node_modules/electron/dist/electron.exe"), [resolve("."), "--clip"], {
         windowsHide: true,
         stdio: "ignore",
         env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
      });
      await new Promise<void>((resolve, reject) => {
         second.on("error", reject);
         second.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Clip command exited ${code}`))));
      });
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 20_000 }).toBe(1);
      expect(
         await desktop.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
               .find((item) => item.getTitle() === "AcroClip")
               ?.isVisible()
         )
      ).toBe(false);
      const clip = (await page.evaluate(() => window.acroClip.state())).clips[0]!;
      expect(clip.source).toBe(title);
      expect(clip.duration).toBeGreaterThan(3);
      const decoded = spawnSync(resolve("resources/media/ffmpeg.exe"), ["-v", "error", "-i", clip.path, "-f", "null", "-"], {
         encoding: "utf8",
         windowsHide: true,
      });
      expect(decoded.status, decoded.stderr).toBe(0);
      const image = spawnSync(
         resolve("resources/media/ffmpeg.exe"),
         ["-v", "error", "-ss", "1", "-i", clip.path, "-vf", "crop=400:200:80:80,signalstats,metadata=print:file=-", "-frames:v", "1", "-f", "null", "-"],
         { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
      );
      expect(image.status).toBe(0);
      const luma = Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(image.stdout)?.[1]);
      const blue = Number(/lavfi.signalstats.UAVG=([\d.]+)/.exec(image.stdout)?.[1]);
      expect(luma).toBeGreaterThan(50);
      expect(blue).toBeGreaterThan(160);
      await desktop.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows().find((item) => item.getTitle() === "AcroClip");
         window?.restore();
         window?.show();
      });
      await page.locator(".rail").getByRole("button", { name: "Library", exact: true }).click();
      await page.getByRole("button", { name: `Open ${clip.name}`, exact: true }).click();
      await expect(page.locator(".viewer-metadata .source-label")).toHaveText(title);
      const metadata = await page.locator(".viewer-metadata").evaluate((node) => {
         const source = node.querySelector(".source-label")!.getBoundingClientRect(),
            time = node.querySelector("time")!.getBoundingClientRect();
         return Math.abs(source.top - time.top);
      });
      expect(metadata).toBeLessThan(1);
      await page.screenshot({ path: "test-results/viewer-known-source.png" });
      await writeFile(action, "exit");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.state, { timeout: 20_000 }).toBe("waiting");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.sourceKind).toBe("waiting");
      await page.evaluate(() => window.acroClip.stopRecording());
      expect((await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds).toBe(0);
      const saved = JSON.parse(await readFile(join(profile, "preferences.json"), "utf8"));
      expect(saved.customGames).toEqual([{ name: title, executable: candidate.executable }]);
      expect(saved.desktopFallback).toBe(false);
   } finally {
      console.log(
         "auto-native.spec.ts final recorder",
         await desktop
            .windows()[0]
            ?.evaluate(() => window.acroClip.state())
            .then((state) => state.recorder)
            .catch(() => undefined)
      );
      await desktop.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
      await desktop.close().catch(() => undefined);
      if (fixture.exitCode === null) fixture.kill();
   }
});
