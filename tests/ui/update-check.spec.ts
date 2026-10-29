import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("development checks fetch release metadata and offer only a release link", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-dev-update-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F3",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await app.evaluate(({ net, shell }) => {
         const fixture = globalThis as typeof globalThis & { metadataChecks?: number; openedRelease?: string };
         fixture.metadataChecks = 0;
         net.fetch = async () => {
            fixture.metadataChecks!++;
            return Response.json({
               tag_name: "v99.0.0",
               name: "AcroClip 99.0.0",
               html_url: "https://example.com/releases/v99.0.0",
               draft: false,
               prerelease: false,
            });
         };
         shell.openExternal = async (url) => {
            fixture.openedRelease = url;
         };
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      await page.getByRole("button", { name: "Check for updates", exact: true }).click();
      await expect(page.locator(".update-panel .field-detail")).toHaveText("An update is available");
      await expect(page.getByRole("button", { name: "Restart to update", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Download update", exact: true })).toHaveCount(0);
      await page.locator(".update-panel").getByRole("button", { name: "View release", exact: true }).click();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { metadataChecks: number }).metadataChecks)).toBe(1);
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { openedRelease: string }).openedRelease)).toBe(
         "https://example.com/releases/v99.0.0"
      );
      expect((await page.evaluate(() => window.acroClip.state())).update).toMatchObject({
         state: "available",
         mode: "releases",
         lastChecked: expect.any(Number),
      });
   } finally {
      await app.close();
   }
});
