import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";
test("Source audio and default microphone migrate, edit, remove and readd without resurrecting removed rows", async () => {
   test.setTimeout(80000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-source-model-")),
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
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         microphone: false,
         microphoneDevice: "missing-device",
         shortcut: "Control+Alt+Shift+F2",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".mixer-channel")).toHaveCount(2);
      let sources = (await page.evaluate(() => window.acroClip.state())).preferences.audioSources;
      expect(sources.map((item) => item.kind)).toEqual(["source", "input"]);
      expect(sources[1]).toMatchObject({ enabled: false, deviceId: "missing-device" });
      await page.getByRole("button", { name: "Microphone options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit source", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Audio source", exact: true })).toContainText("Selected device unavailable");
      await expect(page.getByRole("button", { name: "Save source", exact: true })).toBeDisabled();
      await selectOption(page, "Audio source", "default");
      await page.getByRole("button", { name: "Save source", exact: true }).click();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.audioSources.find((item) => item.kind === "input")?.deviceId)
         .toBe("default");
      expect((await page.evaluate(() => window.acroClip.state())).preferences.audioSources.find((item) => item.kind === "input")?.enabled).toBe(false);
      for (const name of ["Source audio", "Microphone"]) {
         await page.getByRole("button", { name: `${name} options`, exact: true }).click();
         await page.getByRole("menuitem", { name: "Remove source", exact: true }).click();
         await expect(page.getByRole("button", { name: `${name} options`, exact: true })).toHaveCount(0);
      }
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.audioSources.length).toBe(0);
      await page.reload();
      await expect(page.locator(".mixer-channel")).toHaveCount(0);
      await page.getByRole("button", { name: "Add audio source", exact: true }).click();
      await selectOption(page, "Audio source type", "source");
      await page.getByRole("button", { name: "Add source", exact: true }).click();
      await expect(page.getByRole("button", { name: "Source audio options", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator(".mixer-channel")).toHaveCount(1);
      sources = (await page.evaluate(() => window.acroClip.state())).preferences.audioSources;
      expect(sources[0]?.kind).toBe("source");
      expect(sources.some((item) => item.kind === "input")).toBe(false);
      await page.screenshot({ path: "test-results/unified-audio.png" });
   } finally {
      await app.close();
   }
});
