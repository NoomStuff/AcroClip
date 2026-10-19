import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
test("folder browsing keeps the real hierarchy and selected categories blend their own colors", async () => {
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
      await page.screenshot({ path: "test-results/library-folders.png" });
      await page.evaluate(async () => {
         for (const [name, color] of [
            ["Blue", "#73b8ed"],
            ["Rose", "#dc8cc0"],
            ["Dark", "#112233"],
            ["White", "#ffffff"],
         ] as const)
            await window.acroClip.category("create", { name, color });
      });
      const blue = page.getByRole("button", { name: /^Blue/ }).first(),
         rose = page.getByRole("button", { name: /^Rose/ }).first();
      await blue.click();
      await page.waitForTimeout(220);
      const initial = await page.locator(".library-sidebar .sidebar-scroll > .selection-indicator").evaluate((node) => getComputedStyle(node).backgroundColor);
      await rose.click();
      const blend = await page.locator(".library-sidebar .sidebar-scroll > .selection-indicator").evaluate((node) => getComputedStyle(node).backgroundColor);
      await page.waitForTimeout(220);
      const final = await page.locator(".library-sidebar .sidebar-scroll > .selection-indicator").evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(initial).not.toBe(final);
      expect(blend).not.toBe(final);
      for (const name of ["Blue", "Rose", "Dark", "White"]) {
         const button = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
         await button.click();
         await expect.poll(() => button.evaluate((node) => getComputedStyle(node).color === getComputedStyle(node.querySelector("svg")!).color)).toBe(true);
      }
      await blue.hover();
      await expect.poll(() => blue.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(255, 255, 255, 0.02)");
      await page.screenshot({ path: "test-results/category-colors.png" });
   } finally {
      await app.close();
   }
});
