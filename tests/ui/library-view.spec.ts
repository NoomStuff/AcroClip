import { mediaTool } from "./media-tool";
import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";

test("sorting and grouping share one compact control and remember the choice", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-view-")),
      collection = join(profile, "clips");
   await mkdir(collection, { recursive: true });
   // Different lengths and sizes, so every sort and grouping changes the order.
   for (const [name, seconds] of [
      ["Alpha", 1],
      ["Bravo", 35],
      ["Charlie", 3],
   ] as const)
      await promisify(execFile)(mediaTool("ffmpeg"), [
         "-v",
         "error",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=160x90:rate=15",
         "-t",
         String(seconds),
         "-c:v",
         "libx264",
         "-threads",
         "1",
         "-preset",
         "ultrafast",
         join(collection, `${name}.mp4`),
      ]);
   // Clips older than view tracking count as watched. These start as new.
   await mkdir(join(collection, ".acroclip"));
   await writeFile(
      join(collection, ".acroclip", "collection.json"),
      JSON.stringify({ version: 1, collectionId: "library-view", categories: [], clips: [], viewsTrackedSince: 0 })
   );
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
   const launch = () =>
      electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   let app = await launch();
   try {
      let page = await app.firstWindow();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-card")).toHaveCount(3);
      const names = () => page.locator(".clip-card h3").allTextContents();
      const control = page.getByRole("button", { name: "Sort and group", exact: true });
      await expect(control).toHaveAttribute("title", "Sort: Newest first");
      await expect(page.locator(".clip-group-header")).toHaveCount(0);

      await control.click();
      const menu = page.getByRole("menu", { name: "Sort and group", exact: true });
      await expect(menu.getByRole("group", { name: "Sort by" }).getByRole("menuitemradio")).toHaveText(["Date", "Name", "Size", "Length"]);
      await expect(menu.getByRole("group", { name: "Group by" }).getByRole("menuitemradio")).toHaveText([
         "None",
         "Date",
         "Application",
         "Watched",
         "Shared",
         "Size",
         "Length",
      ]);
      for (const item of await menu.getByRole("menuitemradio").all()) await expect(item.locator("svg").first()).toBeVisible();
      await menu.getByRole("menuitemradio", { name: "Length", exact: true }).first().click();
      // Choices keep the menu open, so sort and group can be set together.
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("group", { name: "Order" }).getByRole("menuitemradio")).toHaveText(["Longest first", "Shortest first"]);
      await expect.poll(names).toEqual(["Bravo", "Charlie", "Alpha"]);
      await menu.getByRole("menuitemradio", { name: "Shortest first", exact: true }).click();
      await expect.poll(names).toEqual(["Alpha", "Charlie", "Bravo"]);
      await menu.getByRole("group", { name: "Group by" }).getByRole("menuitemradio", { name: "Length", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.locator(".clip-group-header")).toHaveText(["Under 30 seconds2", "30 seconds to 1 minute1"]);
      await expect(control).toHaveAttribute("title", "Sort: Shortest first. Group: Length");

      await control.click();
      await menu.getByRole("menuitemradio", { name: "Watched", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(page.locator(".clip-group-header")).toHaveText(["New3"]);
      await page.locator(".clip-card", { hasText: "Charlie" }).getByRole("button", { name: "Open Charlie", exact: true }).click();
      await expect(page.locator(".viewer-title")).toContainText("Charlie");
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-group-header")).toHaveText(["New2", "Watched1"]);

      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-group-header")).toHaveText(["New2", "Watched1"]);
      await expect(page.getByRole("button", { name: "Sort and group", exact: true })).toHaveAttribute("title", "Sort: Shortest first. Group: Watched");
   } finally {
      await app.close();
   }
});
