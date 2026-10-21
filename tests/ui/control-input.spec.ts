import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";

test("gain entry commits, rejects invalid input and supports keyboard resets", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-controls-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         setupComplete: true,
         collection,
         sourceKind: "app",
         sourceId: "window:0:0",
         shortcut: "Control+Alt+Shift+F6",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible({ timeout: 15000 });
      const level = page.getByRole("slider", { name: "Source audio level", exact: true });
      await expect(level).toBeVisible();
      const number = page.getByRole("textbox", { name: "Source audio level in decibels", exact: true });
      await number.fill("-6");
      await number.press("Enter");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume, { timeout: 15000 }).toBe(0.5);
      await expect(level).toHaveValue("0.5");
      await expect(number).toHaveValue("-6.0");
      await number.fill("+6.0206");
      await number.press("Enter");
      await expect(level).toHaveValue("1.41");
      await expect(number).toHaveValue("+6.0");
      await number.fill("+12");
      await number.press("Enter");
      await expect(number).toHaveValue("+12.0");
      await expect(level).toHaveValue("1.41");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume).toBe(3.98);
      await number.fill("-inf");
      await number.press("Enter");
      await expect(level).toHaveValue("0");
      await level.focus();
      await level.press("Home");
      await level.press("End");
      await expect(level).toHaveValue("1.41");
      await level.press("Delete");
      await expect(level).toHaveValue("1");
      await expect(number).toHaveValue("0.0");
      await level.press("ArrowLeft");
      await expect(level).toHaveValue("0.99");
      await number.fill("invalid");
      await number.press("Enter");
      await expect(level).toHaveValue("0.99");
      await number.fill("-20");
      await number.press("Escape");
      await number.blur();
      await expect(level).toHaveValue("0.99");
      await level.dblclick();
      await expect(level).toHaveValue("1");
      await page.getByRole("button", { name: "Mute source audio", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureMuted).toBe(true);
      await page.getByRole("button", { name: "Unmute source audio", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Custom", exact: true }).click();
      await selectOption(page, "Resolution limit", "720");
      const resolution = page.getByRole("combobox", { name: "Resolution limit" });
      await expect(resolution).toHaveAttribute("data-value", "720");
      await resolution.press("ArrowDown");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(resolution).toHaveText(/4K/);
      const compression = page.getByRole("spinbutton", { name: "Recording compression value" });
      await compression.fill("22");
      await compression.press("Enter");
      await expect(page.getByRole("slider", { name: "Recording compression", exact: true })).toHaveValue("22");
      await page.getByRole("slider", { name: "Recording compression", exact: true }).press("Delete");
      await expect(compression).toHaveValue("23");
   } finally {
      await desktop.close();
   }
});
