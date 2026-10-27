import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("extra audio rows persist, obey recording boundaries and produce named isolated tracks", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_NATIVE_UI"] !== "1", "Requires actual Windows capture and devices");
   test.setTimeout(90_000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-extra-audio-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         allowSoftwareEncoder: process.env["ACROCLIP_NATIVE_TEST_SOFTWARE"] === "1",
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         quality: "custom",
         customWidth: 640,
         customHeight: 360,
         customFPS: 24,
         clipSeconds: 5,
         captureAudio: false,
         sound: false,
      })
   );
   const audioTitle = `Isolated audio ${Date.now()}`;
   const audioFixture = spawn(resolve(".cache/native-tests/Release/acroclip-d3d-fixture.exe"), [audioTitle, "1337"], {
      stdio: "ignore",
      env: { ...process.env, ACROCLIP_FIXTURE_LONG: "1" },
   });
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await desktop.evaluate(async ({ BrowserWindow }) => {
         const fixture = new BrowserWindow({ title: "Audio track fixture", width: 640, height: 360, frame: false, backgroundColor: "#2255aa" });
         await fixture.loadURL(
            "data:text/html,<title>Audio track fixture</title><body style='margin:0;background:%232255aa'>Controlled audio track fixture</body>"
         );
         fixture.showInactive();
      });
      const target = (await page.evaluate(() => window.acroClip.sources())).find((item) => item.name === "Audio track fixture");
      expect(target).toBeDefined();
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "app", sourceId: id });
      }, target!.id);
      await page.getByRole("button", { name: "Add audio source", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Audio source", exact: true })).toBeEnabled({ timeout: 30000 });
      const audio = (await page.evaluate(() => window.acroClip.games())).find((game) => game.name === audioTitle)!;
      expect(audio).toBeDefined();
      await selectOption(page, "Audio source", audio.id);
      await expect(page.getByRole("checkbox", { name: /Include in master mix/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Add source", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.audioSources.length).toBe(3);
      const source = (await page.evaluate(() => window.acroClip.state())).preferences.audioSources.find((item) => item.name === audioTitle)!;
      expect(source).toMatchObject({ kind: "application", includeInMaster: false, enabled: true });
      await page.getByRole("button", { name: "Start recording", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).recorder.availableSeconds, { timeout: 20_000 }).toBeGreaterThan(3);
      await expect(page.getByRole("button", { name: "Add audio source", exact: true })).toBeDisabled();
      await page.getByRole("slider", { name: `${source.name} level`, exact: true }).fill("0.5");
      await page.getByRole("button", { name: `Mute ${source.name}`, exact: true }).click();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.audioSources.find((item) => item.id === source.id))
         .toMatchObject({ volume: 0.5, muted: true });
      await expect(page.getByRole("button", { name: `Unmute ${source.name}`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^Save clip/ }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).clips.length, { timeout: 20_000 }).toBe(1);
      const saved = (await page.evaluate(() => window.acroClip.state())).clips[0]!;
      expect(saved.tracks.map((track) => track.title)).toEqual(["Master", "Application", "Microphone", source.name]);
      await page.getByRole("button", { name: /^Stop recording/ }).click();
      await page.getByRole("button", { name: `${source.name} options`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Remove source", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.audioSources).toHaveLength(2);
      expect((await page.evaluate(() => window.acroClip.state())).clips[0]?.tracks).toEqual(saved.tracks);
   } finally {
      console.log(
         "audio-native.spec.ts final recorder",
         await desktop
            .windows()[0]
            ?.evaluate(() => window.acroClip.state())
            .then((state) => state.recorder)
            .catch(() => undefined)
      );
      const page = desktop.windows()[0];
      if (page && !page.isClosed()) await page.evaluate(() => window.acroClip.stopRecording()).catch(() => undefined);
      await desktop.close();
      audioFixture.kill();
   }
});
