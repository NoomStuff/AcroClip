import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("field descriptions reach controls and folders support keyboard selection", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-field-accessibility-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, autoRecord: false }));
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Resolution limit", exact: true })).toHaveAccessibleDescription(
         "Screens scale to this limit. Apps keep their original size."
      );
      for (const role of ["slider", "spinbutton"] as const) {
         await expect(
            page.getByRole(role, { name: role === "slider" ? "Capture compression" : "Capture compression value", exact: true })
         ).toHaveAccessibleDescription("Lower values keep more detail and use more space.");
      }
      await expect(page.getByRole("spinbutton", { name: "Clip length", exact: true })).toHaveAccessibleDescription(
         "Save this much recent footage when you clip."
      );
      const evidence = process.env["ACROCLIP_UI_EVIDENCE"];
      if (evidence) {
         await mkdir(evidence, { recursive: true });
         await page.evaluate(() => document.fonts.ready);
         await page.screenshot({ path: join(evidence, "settings-recording.png"), animations: "disabled", scale: "css" });
      }
      await page.evaluate(() => window.acroClip.createFolder("", "Saved"));
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const folder = page.getByRole("treeitem", { name: "Saved", exact: true });
      await folder.focus();
      await folder.press("Space");
      await expect(folder).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".library-heading h1")).toHaveText("Saved");
   } finally {
      await app.close();
   }
});
