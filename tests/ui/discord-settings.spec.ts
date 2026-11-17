import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";

test("Discord status defaults to minimal for existing settings and saves a new choice", async () => {
   test.setTimeout(60000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-discord-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   // Settings saved before the option existed.
   const stored: Partial<typeof defaultPreferences> = { ...defaultPreferences, collection, setupComplete: true, captureAudio: false };
   delete stored.discordPresence;
   await writeFile(join(profile, "preferences.json"), JSON.stringify(stored));
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      const status = page.getByRole("combobox", { name: "Discord status", exact: true });
      await expect(status).toHaveText(/Minimal/);
      await expect(status).toHaveAccessibleDescription("Adds AcroClip's logo and a link to the game you're capturing.");
      await selectOption(page, "Discord status", "off");
      await expect(status).toHaveAccessibleDescription("Leaves your Discord status alone.");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.discordPresence).toBe("off");
      await expect
         .poll(async () => (JSON.parse(await readFile(join(profile, "preferences.json"), "utf8")) as { discordPresence?: string }).discordPresence)
         .toBe("off");
   } finally {
      await app.close();
   }
});
