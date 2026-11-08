import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("Audio filters add, adjust, reorder, disable, persist and remove per source", async () => {
   test.setTimeout(60000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-audio-filters-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, sourceKind: "app", sourceId: "window:0:0", shortcut: "Control+Alt+Shift+F2" })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   const filters = async () =>
      (await app.firstWindow().then((page) => page.evaluate(() => window.acroClip.state()))).preferences.audioSources.find((item) => item.kind === "input")
         ?.filters ?? [];
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".mixer-channel")).toHaveCount(2);
      await expect(page.getByRole("button", { name: /^Microphone filters/ })).toHaveCount(0);
      await page.getByRole("button", { name: "Microphone options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Audio filters", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Microphone filters" });
      await expect(dialog).toBeVisible();
      for (const kind of ["Noise suppression", "Gain"]) {
         await dialog.getByRole("button", { name: "Add filter", exact: true }).click();
         await page.getByRole("menuitem", { name: kind, exact: true }).click();
      }
      await expect.poll(async () => (await filters()).map((item) => item.kind)).toEqual(["noise-suppression", "gain"]);
      // A newly added filter is selected, so its settings are on the right.
      const gain = dialog.getByRole("spinbutton", { name: "Gain value", exact: true });
      await gain.fill("-6");
      await gain.press("Enter");
      await expect.poll(async () => (await filters())[1]?.settings["db"]).toBe(-6);
      await dialog.getByRole("button", { name: "Gain", exact: true }).focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(async () => (await filters()).map((item) => item.kind)).toEqual(["gain", "noise-suppression"]);
      // Right-click opens the same actions as the row menu.
      await dialog.getByRole("button", { name: "Noise suppression", exact: true }).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Turn off", exact: true }).click();
      await expect.poll(async () => (await filters()).map((item) => item.enabled)).toEqual([true, false]);
      // Row actions accept pointer input while the row is hovered, as in the Library.
      const noise = dialog.getByRole("button", { name: "Noise suppression", exact: true });
      for (const action of ["Turn on", "Turn off"]) {
         await noise.hover();
         await dialog.getByRole("button", { name: "Actions for Noise suppression", exact: true }).click();
         await page.getByRole("menuitem", { name: action, exact: true }).click();
         await expect.poll(async () => (await filters()).map((item) => item.enabled)).toEqual([true, action === "Turn on"]);
      }
      await dialog.getByRole("button", { name: "Close microphone filters", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      // Only enabled filters are named in the row's summary.
      await expect(page.getByRole("button", { name: "Microphone filters: Gain", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator(".mixer-channel")).toHaveCount(2);
      expect((await filters()).map((item) => [item.kind, item.enabled])).toEqual([
         ["gain", true],
         ["noise-suppression", false],
      ]);
      await page.getByRole("button", { name: "Microphone filters: Gain", exact: true }).click();
      for (const kind of ["Gain", "Noise suppression"]) {
         await dialog.getByRole("button", { name: kind, exact: true }).hover();
         await dialog.getByRole("button", { name: `Actions for ${kind}`, exact: true }).click();
         await page.getByRole("menuitem", { name: "Remove filter", exact: true }).click();
      }
      await expect.poll(async () => (await filters()).length).toBe(0);
      await expect(dialog.getByText("No filters", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /^Microphone filters/ })).toHaveCount(0);
   } finally {
      await app.close();
   }
});
