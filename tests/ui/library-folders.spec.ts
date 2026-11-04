import { mediaTool } from "./media-tool";
import { test, expect, _electron as electron } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile, stat, readFile } from "node:fs/promises";
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
   await promisify(execFile)(mediaTool("ffmpeg"), [
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
      const gridScale = page.getByRole("slider", { name: "Grid thumbnail size", exact: true });
      await expect(gridScale).toHaveAttribute("aria-valuetext", /^\d+ columns?, \d+px thumbnails$/);
      const sliderElement = await gridScale.elementHandle();
      await gridScale.press("End");
      await page.getByRole("button", { name: "List view", exact: true }).click();
      const listScale = page.getByRole("slider", { name: "List thumbnail size", exact: true });
      expect(await listScale.evaluate((node, previous) => node === previous, sliderElement)).toBe(true);
      await expect(listScale).toHaveValue("96");
      await listScale.press("End");
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
      await expect.poll(() => gridScale.evaluate((node: HTMLInputElement) => node.value === node.max)).toBe(true);
      await gridScale.press("Home");
      const divider = page.getByRole("separator", { name: "Library sidebar width", exact: true });
      const dividerBounds = (await divider.boundingBox())!;
      const sidebarWidth = (await page.locator(".library-sidebar").boundingBox())!.width;
      await page.mouse.move(dividerBounds.x + dividerBounds.width / 2, dividerBounds.y + 80);
      await page.mouse.down();
      await page.mouse.move(dividerBounds.x + dividerBounds.width / 2 + 35, dividerBounds.y + 80);
      await page.mouse.up();
      await expect.poll(async () => (await page.locator(".library-sidebar").boundingBox())!.width).toBeGreaterThan(sidebarWidth + 25);
      await expect(page.locator(".application-filter")).toHaveCount(0);
      const applicationsHeading = page.locator(".sidebar-group-title").filter({ hasText: "Applications" });
      await expect(applicationsHeading).toBeVisible();
      await expect(page.getByRole("region", { name: "Applications", exact: true })).toHaveAttribute("data-empty", "true");
      await expect(applicationsHeading.getByRole("button", { name: "Add game", exact: true })).toBeVisible();
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
               const category = rect(".sidebar-group-title .icon-button");
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
      const foldersToggle = page.getByRole("button", { name: "Folders", exact: true });
      await foldersToggle.click();
      await expect(foldersToggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("treeitem", { name: "Games", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New collection folder", exact: true })).toBeVisible();
      await foldersToggle.press("Space");
      await expect(foldersToggle).toHaveAttribute("aria-expanded", "true");
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
      await page.locator('.library-sidebar [role="treeitem"][data-path="Games"]').click();
      await page.locator('.library-sidebar [role="treeitem"][data-path="Other"]').click();
      await page.dispatchEvent("body", "mouseup", { button: 3 });
      await expect(page.locator(".library-heading h1")).toHaveText("Games");
      await page.dispatchEvent("body", "mouseup", { button: 4 });
      await expect(page.locator(".library-heading h1")).toHaveText("Other");
      await page.keyboard.press("Control+Shift+N");
      const nestedFolder = page.getByRole("dialog", { name: "New folder", exact: true });
      await nestedFolder.getByRole("textbox").fill("Shortcut folder");
      await nestedFolder.getByRole("button", { name: "Create", exact: true }).click();
      await expect(nestedFolder).not.toBeVisible();
      await expect.poll(async () => (await stat(join(collection, "Other", "Shortcut folder")).catch(() => null))?.isDirectory()).toBe(true);
      await page.getByRole("button", { name: "New collection folder", exact: true }).click();
      const newFolder = page.getByRole("dialog", { name: "New folder", exact: true });
      await newFolder.getByRole("textbox").fill("Organized");
      await newFolder.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Organized", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Folder actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Rename folder", exact: true }).click();
      const renameFolder = page.getByRole("dialog", { name: "Rename folder", exact: true });
      await renameFolder.getByRole("textbox").fill("Sorted");
      await renameFolder.getByRole("button", { name: "Rename", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Sorted", exact: true })).toBeVisible();
      await page.locator(".sidebar-scroll > .sidebar-item").first().click();
      await expect
         .poll(() =>
            page
               .locator(".clip-card")
               .first()
               .evaluate((node) => getComputedStyle(node).transform)
         )
         .toBe("none");
      const pendingThumbnails = await page.evaluate(async () => (await window.acroClip.state()).clips.map((clip) => ({ ...clip, thumbnail: "" })));
      await app.evaluate(({ BrowserWindow }, clips) => {
         BrowserWindow.getAllWindows()[0]!.webContents.send("app-event", { type: "state-patch", patch: { clips } });
      }, pendingThumbnails);
      await expect(page.getByRole("button", { name: "Open Root moment", exact: true }).locator(".thumbnail-fallback")).toBeVisible();
      await page.keyboard.down("Shift");
      await page.getByRole("button", { name: "Open Root moment", exact: true }).dragTo(page.locator('.library-sidebar [role="treeitem"][data-path="Sorted"]'));
      await expect.poll(async () => (await stat(join(collection, "Sorted", "Root moment.mp4")).catch(() => null))?.isFile()).toBe(true);
      await page.getByRole("button", { name: "Open Root moment", exact: true }).dragTo(page.locator(".collection-drop"));
      await expect.poll(async () => (await stat(rootClip).catch(() => null))?.isFile()).toBe(true);
      await page.keyboard.up("Shift");
      for (const name of ["Gameplay", "Replay"]) {
         await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
         await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
         const moveClip = page.getByRole("dialog", { name: "Move clip", exact: true });
         await moveClip.getByRole("treeitem", { name: "Sorted", exact: true }).click();
         await moveClip.getByRole("button", { name: "Move here", exact: true }).click();
         await expect(moveClip).not.toBeVisible();
      }
      expect((await stat(join(collection, "Sorted", "Gameplay.mp4"))).isFile()).toBe(true);
      expect((await stat(join(collection, "Sorted", "Replay.mp4"))).isFile()).toBe(true);
      await writeFile(join(collection, "Sorted", "notes.txt"), "Keep unsupported files");
      await page.locator('.library-sidebar [role="treeitem"][data-path="Sorted"]').click();
      await page.getByRole("button", { name: "Folder actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Move to folder", exact: true }).click();
      const moveFolder = page.getByRole("dialog", { name: "Move Sorted", exact: true });
      await moveFolder.getByRole("treeitem", { name: "Games", exact: true }).press("ArrowRight");
      await moveFolder.locator('[role="treeitem"][data-path="Games/Empty"]').click();
      await app.evaluate(({ dialog }) => {
         dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
            const message = options ?? (windowOrOptions as Electron.MessageBoxOptions);
            if (!message.detail?.includes("2 clips") || !message.detail.includes("1 other file")) throw new Error("Folder move must describe all contents");
            if (message.defaultId !== 1 || message.cancelId !== 0) throw new Error("Enter must confirm the move and Escape must cancel");
            return { response: 1, checkboxChecked: false };
         };
      });
      await moveFolder.getByRole("button", { name: "Move here", exact: true }).click();
      await expect(moveFolder).not.toBeVisible();
      expect(await readFile(join(collection, "Games", "Empty", "Sorted", "notes.txt"), "utf8")).toBe("Keep unsupported files");
      await app.evaluate(({ dialog }) => {
         dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, options?: Electron.MessageBoxOptions) => {
            const message = options ?? (windowOrOptions as Electron.MessageBoxOptions);
            if (message.defaultId !== 0 || message.cancelId !== 0 || !message.detail?.includes("1 other file"))
               throw new Error("Folder deletion must default to Cancel and describe unrelated files");
            return { response: 0, checkboxChecked: false };
         };
      });
      expect(await page.evaluate(() => window.acroClip.deleteFolder("Games/Empty/Sorted"))).toBe(false);
      expect(await readFile(join(collection, "Games", "Empty", "Sorted", "notes.txt"), "utf8")).toBe("Keep unsupported files");
      await expect(page.getByRole("button", { name: "Open Gameplay", exact: true })).toBeVisible();
   } finally {
      await app.close();
   }
});
