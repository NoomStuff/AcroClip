import { selectOption } from "./select-option";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("onboarding UI persists choices without starting recording or OS startup", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-setup-flow-"));
   const collection = join(profile, "clips");
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({ ...defaultPreferences, collection, shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" } })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
   });
   try {
      const page = await desktop.firstWindow();
      // Setup choices do not require recording the host's desktop.
      if (!(await page.evaluate(() => window.acroClip.sources())).some((source) => source.kind === "screen")) {
         await desktop.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler("sources");
            ipcMain.handle("sources", () => [{ id: "screen:setup-fixture", name: "Setup test screen", kind: "screen", thumbnail: "" }]);
         });
         await page.reload();
      }
      await expect(page.getByRole("heading", { name: "What do you want to capture?", exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Microphone input", exact: true })).toHaveAttribute("data-value", "default");
      await selectOption(page, "Microphone input", "none");
      await page.locator(".onboarding").getByRole("button", { name: "Auto", exact: true }).click();
      await expect(page.locator(".onboarding")).toContainText("Follows your game. Waits when no game is open.");
      await page.locator(".onboarding").getByRole("button", { name: "Screen", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Save a moment", exact: true })).toBeVisible();
      await page.getByRole("spinbutton", { name: "Setup clip length in seconds" }).fill("30");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Microphone input", exact: true })).toHaveAttribute("data-value", "none");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("spinbutton", { name: "Setup clip length in seconds" })).toHaveValue("30");
      await page.getByRole("spinbutton", { name: "Setup clip length in seconds" }).fill("");
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
      await expect(page.getByRole("alert").filter({ hasText: "Choose 5 to 1800 whole seconds." })).toBeVisible();
      await page.getByRole("spinbutton", { name: "Setup clip length in seconds" }).fill("45");
      await page.getByRole("button", { name: "Clip shortcut", exact: true }).click();
      await expect(page.getByRole("button", { name: "Clip shortcut", exact: true })).toHaveText(/Press a shortcut/);
      await page.getByRole("button", { name: "Clip shortcut", exact: true }).press("Control+Alt+Shift+F9");
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "You're good to go", exact: true })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Start with your computer", exact: true })).not.toBeChecked();
      await expect(page.getByRole("checkbox", { name: "Start recording when AcroClip opens", exact: true })).not.toBeChecked();
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await expect(page.locator(".onboarding"), "Setup should close after saving")
         .toHaveCount(0)
         .catch(async (error: unknown) => {
            console.log("Setup feedback", await page.locator(".toast").allTextContents());
            throw error;
         });
      const state = await page.evaluate(() => window.acroClip.state());
      expect(state.preferences).toMatchObject({
         collection,
         clipSeconds: 45,
         shortcut: "Control+Alt+Shift+F9",
         allowSoftwareEncoder: false,
         shareSizeMB: 20,
         autoShare: false,
         setupComplete: true,
         microphone: true,
         microphoneDevice: "default",
         microphoneMuted: true,
         autoRecord: false,
         startWithOS: false,
      });
      expect(state.preferences.sourceId).not.toBe("");
      expect(state.recorder.state).toBe("stopped");
      await page.getByRole("slider", { name: "Source audio level", exact: true }).fill("0.5");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureVolume).toBe(0.5);
      await page.getByRole("button", { name: "Mute source audio", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.captureMuted).toBe(true);
      await expect(page.getByRole("button", { name: "Unmute source audio", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await selectOption(page, "Resolution limit", "720");
      await expect(page.getByRole("combobox", { name: "Resolution limit" })).toHaveAttribute("data-value", "720");
      await expect(page.getByRole("button", { name: "Audio", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: /^High/ }).click();
      await expect(page.getByRole("button", { name: /^High/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("combobox", { name: "Resolution limit" })).toHaveAttribute("data-value", "0");
      await page.getByRole("combobox", { name: "Resolution limit" }).click();
      await expect(page.getByRole("option").last()).toHaveText("Source");
      await expect(page.getByRole("option", { name: "Original", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("slider", { name: "Recording compression", exact: true })).toHaveValue("18");
      await selectOption(page, "Resolution limit", "1440");
      await expect(page.getByRole("button", { name: "Custom", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("spinbutton", { name: "Recording frame rate" }).fill("48");
      await page.getByRole("slider", { name: "Recording compression" }).fill("25");
      await page.locator(".quality-advanced > summary").click();
      await expect(page.getByRole("checkbox", { name: /Allow software encoding/ })).not.toBeChecked();
      await page.getByRole("checkbox", { name: /Allow software encoding/ }).check();
      await page.waitForTimeout(300);
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences)
         .toMatchObject({ resolutionLimit: 1440, customFPS: 48, customCQ: 25, allowSoftwareEncoder: true });
      await page.getByRole("button", { name: "Sharing", exact: true }).click();
      await expect(page.getByRole("spinbutton", { name: "Default shareable size in MB" })).toHaveValue("20");
      await page.getByRole("spinbutton", { name: "Default shareable size in MB" }).fill("50");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.shareSizeMB).toBe(50);
      await page.getByRole("button", { name: "Collection", exact: true }).click();
      await selectOption(page, "Filename preset", "custom");
      const pattern = page.getByRole("textbox", { name: "Name pattern" });
      await pattern.fill("Moment ");
      await page.locator(".filename-tokens").getByTitle("{source}", { exact: true }).click();
      await expect(pattern).toHaveValue("Moment {source}");
      await pattern.press("Control+Z");
      await expect(pattern).toHaveValue("Moment ");
      await pattern.fill("{unknown}");
      await expect(page.locator(".settings-save-feedback")).toBeVisible();
      await pattern.fill("../outside");
      await expect(page.locator(".settings-save-feedback")).toBeVisible();
      await pattern.fill("Moment {source} {date} {time}");
      await expect(page.locator(".filename-preview")).toContainText("Moment Desktop 2026-10-08 19-42-10-a1b2c3d4.mkv");
      await page.waitForTimeout(300);
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences)
         .toMatchObject({ filenamePreset: "custom", filenameTemplate: "Moment {source} {date} {time}", folderLayout: "flat" });
   } finally {
      await desktop.close();
   }
});
