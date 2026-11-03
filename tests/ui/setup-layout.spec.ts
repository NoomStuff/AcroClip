import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type { CaptureSource } from "../../src/shared/types";

test("setup keeps overflowing source rows reachable without shrinking previews", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-setup-layout-"));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection: join(profile, "clips"),
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
      })
   );
   const sources: CaptureSource[] = [
      { id: "screen:setup-layout", name: "Setup screen", kind: "screen", thumbnail: "" },
      ...Array.from({ length: 7 }, (_, index): CaptureSource => ({
         id: `window:setup-layout-${index}`,
         name: `Setup app ${index + 1}`,
         kind: "app",
         thumbnail: "",
      })),
   ];
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ ipcMain }, choices) => {
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", () => choices);
      }, sources);
      await page.reload();
      const dialog = page.locator(".onboarding");
      for (const width of [980, 640]) {
         await desktop.evaluate(({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0]!;
            window.setMinimumSize(0, 0);
            window.setSize(size, 740);
         }, width);
         await dialog.getByRole("button", { name: "App", exact: true }).click();
         const tiles = dialog.locator(".setup-source-tile");
         await expect(tiles).toHaveCount(7);
         const viewport = dialog.locator(".setup-source");
         await viewport.evaluate((element) => {
            element.scrollTop = 0;
         });
         const first = tiles.first();
         await expect
            .poll(async () => {
               const bounds = (await viewport.boundingBox())!;
               return (await first.boundingBox())!.y - bounds.y;
            })
            .toBeGreaterThanOrEqual(0);
         const preview = (await first.locator(".setup-source-preview").boundingBox())!;
         expect(Math.abs(preview.width / preview.height - 16 / 9)).toBeLessThan(0.02);
         expect(preview.height).toBeGreaterThan(90);
         await tiles.last().focus();
         await expect
            .poll(async () => {
               const bounds = (await viewport.boundingBox())!;
               const last = (await tiles.last().boundingBox())!;
               return last.y + last.height - bounds.y - bounds.height;
            })
            .toBeLessThanOrEqual(1);
         await page.keyboard.press("Enter");
         await expect(tiles.last()).toHaveAttribute("aria-pressed", "true");
         await first.focus();
         await expect.poll(async () => (await first.boundingBox())!.y - (await viewport.boundingBox())!.y).toBeGreaterThanOrEqual(0);
         await page.screenshot({ path: `test-results/setup-source-layout-${width}.png` });
         await dialog.getByRole("button", { name: "Screen", exact: true }).click();
         await expect(tiles).toHaveCount(1);
         await expect(dialog.getByRole("combobox", { name: "Microphone input", exact: true })).toBeVisible();
         await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
      }
   } finally {
      await desktop.close();
   }
});
