import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("notification choices save independently and error banners cannot be disabled", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-notification-settings-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true }));
   const app = await electron.launch({
      args: [resolve(".")],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
   });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.locator(".settings-sidebar").getByRole("button", { name: "Notifications", exact: true }).click();
      await expect(page.locator(".notification-settings-row")).toHaveCount(4);
      const banner = page.getByRole("checkbox", { name: "Error banner", exact: true });
      await expect(banner).toBeChecked();
      await expect(banner).toBeDisabled();
      await page.getByRole("checkbox", { name: "Start capture banner", exact: true }).uncheck();
      await page.getByRole("checkbox", { name: "Stop capture sound", exact: true }).uncheck();
      await page.getByRole("checkbox", { name: "Error sound", exact: true }).uncheck();
      await expect
         .poll(async () => {
            const preferences = (await page.evaluate(() => window.acroClip.state())).preferences;
            return [
               preferences.notificationStartBanner,
               preferences.notificationStartSound,
               preferences.notificationStopBanner,
               preferences.notificationStopSound,
               preferences.notificationSaveSound,
               preferences.notificationErrorBanner,
               preferences.notificationErrorSound,
            ];
         })
         .toEqual([false, true, true, false, true, true, false]);
      const rejected = await page.evaluate(async () => {
         const { preferences } = await window.acroClip.state();
         try {
            // Deliberately send malformed data across the IPC boundary.
            await window.acroClip.savePreferences(Object.assign({}, preferences, { notificationErrorBanner: false }));
            return false;
         } catch {
            return true;
         }
      });
      expect(rejected).toBe(true);
      await expect(banner).toBeChecked();
      await expect(page.locator(".settings-main")).not.toContainText("Fullscreen");
   } finally {
      await app.close();
   }
});
