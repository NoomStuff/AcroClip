import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
import { mediaTool } from "./media-tool";

test("visual review covers primary screens and settings at narrow widths", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-visual-review-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   const video = join(collection, "Overtime comeback.mp4");
   await promisify(execFile)(mediaTool("ffmpeg"), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      video,
   ]);
   await copyFile(video, join(collection, "A very long clip name that should stay readable in the library.mp4"));
   await copyFile(video, join(collection, "Last round.mp4"));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
      })
   );
   const app = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
   });
   try {
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const evidence = process.env["ACROCLIP_UI_EVIDENCE"];
      const capture = async (name: string) => {
         if (!evidence) return;
         await mkdir(evidence, { recursive: true });
         await page.screenshot({ path: join(evidence, `${name}.png`), animations: "disabled" });
      };
      await expect(page.locator(".recording-page")).toBeVisible();
      await capture("recording");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-card")).toHaveCount(3);
      await expect(page.locator(".clip-thumbnail img").first()).toBeVisible();
      await capture("library");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      for (const width of [1280, 980, 760]) {
         await app.evaluate(({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0]!;
            window.setMinimumSize(0, 0);
            window.setSize(size, 800);
         }, width);
         for (const section of ["Recording", "Collection", "Notifications", "Shortcuts", "App & updates"]) {
            await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
            await expect(page.locator(".settings-heading")).toHaveText(section);
            if (section === "Recording") {
               await expect(page.getByRole("combobox", { name: "Resolution limit", exact: true })).toHaveAccessibleDescription(
                  "Screens scale to this limit. Apps keep their original size."
               );
               await expect(page.getByRole("slider", { name: "Recording compression", exact: true })).toHaveAccessibleDescription(
                  "Lower values keep more detail and use more space."
               );
               await expect(page.getByRole("spinbutton", { name: "Recording compression value", exact: true })).toHaveAccessibleDescription(
                  "Lower values keep more detail and use more space."
               );
               await expect(page.getByRole("spinbutton", { name: "Clip length", exact: true })).toHaveAccessibleDescription(
                  "Save this much recent footage when you clip."
               );
            }
            await capture(`settings-${section.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${width}`);
            const overflow = await page.locator(".settings-body").evaluate((element) => element.scrollWidth - element.clientWidth);
            expect(overflow, `${section} fits at ${width}px`).toBeLessThanOrEqual(1);
            const escapedControls = await page.locator(".settings-row.field").evaluateAll((rows) =>
               rows.flatMap((row) => {
                  const control = row.querySelector<HTMLElement>(".field-control");
                  const copy = row.querySelector<HTMLElement>(".field-copy");
                  if (!control || !copy) return [];
                  const bounds = row.getBoundingClientRect();
                  const input = control.getBoundingClientRect();
                  const text = copy.getBoundingClientRect();
                  const overlap = input.top < text.bottom && input.bottom > text.top && input.left < text.right;
                  return input.right > bounds.right + 1 || input.left < bounds.left - 1 || overlap ? [copy.textContent] : [];
               })
            );
            expect(escapedControls, `${section} controls stay inside their rows without overlapping labels at ${width}px`).toEqual([]);
         }
      }
   } finally {
      await app.close();
   }
});
