import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type { Clip } from "../../src/shared/types";

test("expanded sections reorder in a scrolling sidebar and large libraries bound thumbnail work", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-expanded-drag-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   for (let i = 0; i < 24; i++) await mkdir(join(collection, `Folder ${i.toString().padStart(2, "0")}`));
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, autoRecord: false }));
   const application = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await application.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680));
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).collectionStatus.phase)).toBe("ready");
      await page.evaluate(() => window.acroClip.category("create", { name: "Highlights", color: "#b197fc" }));
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const labels = page.locator(".sidebar-section-control");
      const tags = page.getByRole("button", { name: "Tags", exact: true });
      const folders = page.getByRole("button", { name: "Folders", exact: true });
      // Establish a known order while keeping the tall section expanded.
      await folders.press("Alt+ArrowUp");
      await expect(labels).toHaveText(["Tags", "Folders", "Applications"]);
      await page.locator(".sidebar-scroll").evaluate((node) => {
         node.scrollTop = 0;
      });
      await page.waitForTimeout(400);
      const start = await folders.boundingBox();
      await page.mouse.move(start!.x + 45, start!.y + start!.height / 2);
      await page.mouse.down();
      await page.mouse.move(start!.x + 45, start!.y + start!.height / 2 + 70, { steps: 12 });
      await expect.poll(async () => (await folders.boundingBox())!.y).toBeGreaterThan(start!.y + 40);
      const dragBounds = await folders.evaluate((handle) => {
         const row = handle.closest(".motion-list-content")!;
         const list = row.parentElement!.parentElement!;
         return { bottom: row.getBoundingClientRect().bottom, limit: list.getBoundingClientRect().bottom };
      });
      expect(dragBounds.bottom).toBeLessThanOrEqual(dragBounds.limit + 1);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(labels).toHaveText(["Tags", "Folders", "Applications"]);
      const tagBounds = await tags.boundingBox();
      const sidebar = await page.locator(".sidebar-scroll").boundingBox();
      await page.mouse.move(tagBounds!.x + 40, tagBounds!.y + tagBounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(tagBounds!.x + 40, sidebar!.y + sidebar!.height - 8, { steps: 20 });
      await page.waitForTimeout(2500);
      await page.mouse.up();
      await expect(labels).toHaveText(["Folders", "Applications", "Tags"]);
      expect(errors).toEqual([]);
      await page.getByRole("button", { name: "All clips", exact: false }).click();
      const clips: Clip[] = Array.from({ length: 1000 }, (_, index) => ({
         id: `clip-${index}`,
         path: join(collection, `${index}.mp4`),
         relativePath: `${index}.mp4`,
         name: `Clip ${index.toString().padStart(4, "0")}`,
         source: "",
         size: 1000,
         duration: 10,
         width: 320,
         height: 180,
         createdAt: 1000 - index,
         thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="purple"/></svg>',
         playbackUrl: "",
         tracks: [],
         categories: [],
         shareables: [],
      }));
      const started = performance.now();
      await application.evaluate(({ BrowserWindow }, fixture) => {
         const contents = BrowserWindow.getAllWindows()[0]!.webContents;
         const publish = contents.send.bind(contents);
         contents.send = (channel, ...args) => {
            if (channel === "app-event" && ["state", "state-patch"].includes((args[0] as { type?: string })?.type ?? "")) return;
            publish(channel, ...args);
         };
         publish("app-event", { type: "state-patch", patch: { clips: fixture } });
      }, clips);
      await expect(page.locator(".clip-card")).toHaveCount(1000);
      await expect.poll(() => page.locator(".clip-thumbnail > img").count()).toBeGreaterThan(0);
      expect(await page.locator(".clip-thumbnail > img").count()).toBeLessThan(80);
      const countSlot = page.locator(".library-sidebar .sidebar-item").filter({ hasText: "All clips" }).locator(".count");
      const slot = await countSlot.boundingBox();
      const normal = await countSlot.locator("span").boundingBox();
      expect(normal!.x + normal!.width / 2).toBeCloseTo(slot!.x + slot!.width / 2, 0);
      await countSlot.locator("span").evaluate((node) => {
         node.textContent = "123456789";
      });
      const wide = await countSlot.locator("span").boundingBox();
      expect(wide!.x).toBeLessThan(slot!.x);
      expect(wide!.x + wide!.width).toBeCloseTo(slot!.x + slot!.width, 0);
      await countSlot.locator("span").evaluate((node) => {
         node.textContent = "1000";
      });
      console.log(
         `1000-record library ready in ${Math.round(performance.now() - started)}ms, ${await page.locator(".clip-thumbnail > img").count()} thumbnail images mounted`
      );
      await page.locator(".library-scroll").evaluate((node) => {
         node.scrollTop = node.scrollHeight;
      });
      await expect(page.getByRole("button", { name: "Open Clip 0999", exact: true }).locator(".clip-thumbnail > img")).toBeVisible();
      expect(await page.locator(".clip-thumbnail > img").count()).toBeLessThan(80);
      await page.getByRole("button", { name: "List view", exact: true }).click();
      await expect.poll(() => page.locator(".clip-thumbnail > img").count()).toBeGreaterThan(0);
      expect(await page.locator(".clip-thumbnail > img").count()).toBeLessThan(80);
      await page.getByRole("textbox", { name: "Search clips", exact: true }).fill("Clip 0999");
      await expect(page.locator(".clip-card")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Open Clip 0999", exact: true }).locator(".clip-thumbnail > img")).toBeVisible();
      expect(errors).toEqual([]);
   } finally {
      await application.close();
   }
});
