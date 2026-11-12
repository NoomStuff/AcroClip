import { test, expect, _electron as electron } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type { AppState, Clip } from "../../src/shared/types";

const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

/**
 * Scrolls the whole library and checks what a full grid would guarantee: the viewport is always
 * covered by mounted rows, and an item never changes place between two visits.
 */
async function audit(page: Page, label: string): Promise<number> {
   const scroller = page.locator(".library-scroll");
   const range = await scroller.evaluate((node) => node.scrollHeight - node.clientHeight);
   const places = new Map<string, number>();
   for (let step = 0; step <= 16; step++) {
      await scroller.evaluate((node, top) => (node.scrollTop = top), Math.round((range * step) / 16));
      await settle(page);
      const view = await page.evaluate(() => {
         const viewport = document.querySelector(".library-scroll")!.getBoundingClientRect();
         const grid = document.querySelector<HTMLElement>(".clip-grid")!;
         const origin = grid.getBoundingClientRect().top;
         const children = Array.from(grid.children) as HTMLElement[];
         const items = children.filter((node) => node.dataset["layoutKey"]);
         const places = items.map((node) => ({ key: node.dataset["layoutKey"]!, top: Math.round(node.getBoundingClientRect().top - origin) }));
         const first = items[0]?.getBoundingClientRect(),
            last = items.at(-1)?.getBoundingClientRect();
         return {
            places,
            covered:
               !!first &&
               !!last &&
               (first.top <= viewport.top + 1 || children[0] === items[0]) &&
               (last.bottom >= viewport.bottom - 1 || children.at(-1) === items.at(-1)),
         };
      });
      expect(view.covered, `${label}: the viewport is covered at step ${step}`).toBe(true);
      expect(view.places.length, `${label}: mounted items`).toBeLessThan(160);
      for (const item of view.places) {
         const before = places.get(item.key);
         if (before !== undefined) expect(Math.abs(before - item.top), `${label}: ${item.key} stays in place`).toBeLessThanOrEqual(1);
         places.set(item.key, item.top);
      }
   }
   return places.size;
}

test("a large library mounts only the rows in view and still behaves like the whole grid", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-window-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, autoRecord: false }));
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   const errors: string[] = [];
   try {
      const page = await app.firstWindow();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
         if (message.type() === "error") errors.push(message.text());
      });
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).collectionStatus.phase)).toBe("ready");
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).windowVisible)).toBe(true);
      await expect(page.locator(".recording-page")).toBeVisible();
      const actual = await page.evaluate(() => window.acroClip.state());
      // An odd count leaves the last row part full.
      const count = 1003;
      const clips = Array.from({ length: count }, (_, index): Clip => ({
         id: `clip-${index}`,
         name: `Moment ${index}`,
         path: join(collection, `Game ${index % 7}`, `clip-${index}.mp4`),
         relativePath: `Game ${index % 7}/clip-${index}.mp4`,
         source: `Game ${index % 7}`,
         applicationId: `app-${index % 7}`,
         size: 40_000_000,
         duration: 30,
         width: 1920,
         height: 1080,
         createdAt: Date.now() - index * 3_600_000,
         thumbnail: "",
         playbackUrl: "",
         categories: [],
         tracks: [],
         shareables: [],
         watched: true,
      }));
      const state: AppState = { ...actual, clips, folders: Array.from({ length: 7 }, (_, index) => `Game ${index}`) };
      await app.evaluate(({ BrowserWindow, ipcMain }, fixture) => {
         const contents = BrowserWindow.getAllWindows()[0]!.webContents;
         const publish = contents.send.bind(contents);
         contents.send = (channel, ...args) => {
            if (channel === "app-event" && ["state", "state-patch"].includes((args[0] as { type?: string })?.type ?? "")) return;
            publish(channel, ...args);
         };
         // The fixture's clips have no files to refresh or make hover strips from.
         for (const channel of ["refresh", "keyframes"]) {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, () => null);
         }
         publish("app-event", { type: "state", state: fixture });
      }, state);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".library-count")).toContainText(`${count} clips`);
      const last = page.getByRole("button", { name: `Open Moment ${count - 1}`, exact: true });

      expect(await audit(page, "grid")).toBeGreaterThan(160);
      await expect(last).toBeVisible();

      // Group headers take rows of their own, and a folded group gives its rows back.
      await page.getByRole("button", { name: "Sort and group", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Application", exact: true }).click();
      await page.locator(".library-scroll").evaluate((node) => (node.scrollTop = 0));
      await expect(page.locator(".clip-group-header").first()).toBeVisible();
      await audit(page, "grouped");
      await page.locator(".library-scroll").evaluate((node) => (node.scrollTop = 0));
      const grouped = await page.locator(".library-scroll").evaluate((node) => node.scrollHeight);
      await page.locator(".clip-group-control").first().click();
      await expect.poll(() => page.locator(".library-scroll").evaluate((node) => node.scrollHeight)).toBeLessThan(grouped * 0.9);
      await page.locator(".clip-group-control").first().click();
      await page.getByRole("button", { name: "Sort and group", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "None", exact: true }).click();

      await page.getByRole("button", { name: "List view", exact: true }).click();
      await page.waitForTimeout(500);
      expect(await audit(page, "list")).toBeGreaterThan(160);
      await expect(last).toBeVisible();
      // Zooming the list resizes its rows over several frames. The window follows them to the new size.
      await page.getByRole("slider", { name: "List thumbnail size", exact: true }).press("End");
      await page.waitForTimeout(600);
      await audit(page, "zoomed list");
      await expect(last).toBeVisible();
      await page.getByRole("slider", { name: "List thumbnail size", exact: true }).press("Home");
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
      await page.waitForTimeout(500);

      // Search reaches clips that are not mounted. Clearing it glides the cards back, and Tab
      // pressed faster than that animation still walks card to card instead of leaving the grid.
      const search = page.getByRole("textbox", { name: "Search clips", exact: true });
      await search.fill("Moment 999");
      await expect(page.locator(".clip-card")).toHaveCount(1);
      await search.fill("");
      await page.locator(".clip-open").first().focus();
      for (let presses = 0; presses < 120; presses++) await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Open Moment 60", exact: true })).toBeFocused();
      for (let presses = 0; presses < 40; presses++) await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "Open Moment 40", exact: true })).toBeFocused();
      expect(errors).toEqual([]);
   } finally {
      await app.close();
   }
});
