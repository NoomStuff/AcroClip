import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
test("folder browsing keeps the real hierarchy and empty directories accessible", async () => {
   test.setTimeout(100000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-tree-")),
      collection = join(profile, "clips");
   await mkdir(join(collection, "Games", "Highlights"), { recursive: true });
   await mkdir(join(collection, "Games", "Empty"), { recursive: true });
   await mkdir(join(collection, "Other", "Empty"), { recursive: true });
   const rootClip = join(collection, "Root moment.mp4");
   await promisify(execFile)(resolve("resources/media/ffmpeg.exe"), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=15",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "ultrafast",
      rootClip,
   ]);
   await copyFile(rootClip, join(collection, "Games", "Gameplay.mp4"));
   await copyFile(rootClip, join(collection, "Games", "Highlights", "Replay.mp4"));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         captureAudio: false,
         sourceKind: "app",
         sourceId: "window:0:0",
         shortcut: "Control+Alt+Shift+F2",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-card")).toHaveCount(3);
      await expect(page.locator(".application-filter")).toHaveCount(0);
      await expect(page.locator(".sidebar-group-title").filter({ hasText: "Applications" })).toHaveCount(0);
      // Read one animation frame, rather than comparing rectangles sampled at
      // different positions during the directional page transition.
      await expect
         .poll(() =>
            page.locator(".library-sidebar").evaluate((sidebar) => {
               const rect = (selector: string) => {
                  const element = sidebar.querySelector(selector);
                  if (!element) throw new Error(`Missing sidebar control: ${selector}`);
                  return element.getBoundingClientRect();
               };
               const action = rect(".collection-home .header-actions button");
               const title = rect(".collection-home .context-header-title");
               const category = rect(".sidebar-group-title button");
               const count = rect(".sidebar-scroll > .sidebar-item > .count");
               return Math.max(
                  Math.abs(action.y + action.height / 2 - title.y - title.height / 2),
                  Math.abs(action.x + action.width / 2 - category.x - category.width / 2),
                  Math.abs(action.x + action.width / 2 - count.x - count.width / 2)
               );
            })
         )
         .toBeLessThan(1);
      await page.locator(".collection-home button").first().click();
      await expect(page.getByRole("button", { name: "Open folder Games", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open Root moment", exact: true })).toBeVisible();
      expect(await page.locator(".clip-grid .clip-open").first().getAttribute("aria-label")).toMatch(/^Open folder /);
      await expect(page.getByRole("treeitem", { name: "Highlights", exact: true })).toHaveCount(0);
      const games = page.getByRole("treeitem", { name: "Games", exact: true });
      await games.focus();
      await games.press("ArrowRight");
      await expect(page.getByRole("treeitem", { name: "Highlights", exact: true })).toBeVisible();
      await games.press("Enter");
      await expect(page.getByRole("button", { name: "Open Gameplay", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Open Replay", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Open folder Games/Highlights", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open Replay", exact: true })).toBeVisible();
      await expect(page.getByRole("treeitem", { name: "Highlights", exact: true })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("navigation", { name: "Folder path" }).getByRole("button", { name: "Games", exact: false }).click();
      await page.getByRole("button", { name: "Open folder Games/Empty", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Folder is empty", exact: true })).toBeVisible();
   } finally {
      await app.close();
   }
});
