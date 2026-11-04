import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultPreferences } from "../../src/shared/defaults";
test("tag appearance, local shortcuts, conflicts and global capture bindings persist", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-features-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         audioSourcesVersion: undefined,
         audioSources: [],
         collection,
         setupComplete: true,
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         shortcut: "Control+Alt+Shift+F5",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   let failed = false;
   await app.context().tracing.start({ screenshots: true, snapshots: true });
   try {
      const page = await app.firstWindow();
      const focusNavigation = async () => {
         await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))).toBe(true);
         await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
            if (!window) throw new Error("The test window is not visible");
            window.focus();
         });
         const recording = page.getByRole("button", { name: "Recording", exact: true });
         await recording.focus();
         await expect(recording).toBeFocused();
         await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
      };
      await expect(page.locator(".recording-page")).toBeVisible();
      await focusNavigation();
      await page.keyboard.press("Control+2");
      await expect(page.locator(".library-page")).toBeVisible();
      const sectionLabels = page.locator(".sidebar-section-control");
      await expect(sectionLabels).toHaveText(["Tags", "Applications", "Folders"]);
      await expect(page.locator(".sidebar-section[data-empty]")).toHaveCount(3);
      const emptyTags = page.locator('.sidebar-section[aria-label="Tags"]');
      const tagHandle = emptyTags.locator(".sidebar-section-control");
      const handleBounds = (await tagHandle.boundingBox())!;
      await page.mouse.move(handleBounds.x + 30, handleBounds.y + handleBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBounds.x + 60, handleBounds.y + handleBounds.height / 2, { steps: 5 });
      await expect(emptyTags.locator("xpath=ancestor::div[@data-dragging][1]")).toHaveCount(1);
      await expect(tagHandle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.mouse.up();
      await page.getByRole("button", { name: "List view", exact: true }).hover();
      await expect(emptyTags).toHaveCSS("opacity", "0.4");
      await page.evaluate(() => window.acroClip.createFolder("", "Saved"));
      await expect(sectionLabels).toHaveText(["Tags", "Applications", "Folders"]);
      await page.getByRole("button", { name: "List view", exact: true }).click();
      await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Control+f");
      const search = page.getByRole("textbox", { name: "Search clips", exact: true });
      await expect(search).toBeFocused();
      await search.fill("typing");
      await search.press("Control+1");
      await expect(page.locator(".library-page")).toBeVisible();
      await search.clear();
      await search.blur();
      await expect(page.getByRole("button", { name: "New tag", exact: true })).toHaveCount(1);
      await page.keyboard.press("Control+n");
      const category = page.getByRole("dialog", { name: "New tag", exact: true });
      await expect(category).toBeVisible();
      await category.getByRole("textbox", { name: "Tag name" }).fill("Highlights");
      await category.getByRole("button", { name: "More tag icons", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Icon: rocket", exact: true }).click();
      await category.getByLabel("Custom tag color").fill("#112233");
      await category.getByRole("button", { name: "Create", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.length).toBe(1);
      await expect(sectionLabels).toHaveText(["Tags", "Applications", "Folders"]);
      await tagHandle.press("Alt+ArrowDown");
      await expect(sectionLabels).toHaveText(["Applications", "Tags", "Folders"]);
      await tagHandle.press("Alt+ArrowUp");
      await expect(sectionLabels).toHaveText(["Tags", "Applications", "Folders"]);
      const original = (await page.evaluate(() => window.acroClip.state())).categories[0]!;
      expect(original).toMatchObject({ name: "Highlights", color: "#112233", icon: "rocket" });
      const highlightRow = page.locator(".category-item").filter({ hasText: "Highlights" });
      await page.getByRole("button", { name: "List view", exact: true }).hover();
      await expect(highlightRow.locator(".count")).toBeVisible();
      await highlightRow.hover();
      await expect(highlightRow.locator(".count")).toBeHidden();
      await expect
         .poll(() =>
            highlightRow.evaluate((row) => {
               const count = row.querySelector(".count")!.getBoundingClientRect();
               const menu = row.querySelector(".menu-wrap button")!.getBoundingClientRect();
               return Math.abs(count.x + count.width / 2 - menu.x - menu.width / 2);
            })
         )
         .toBeLessThan(1);
      await highlightRow.click({ button: "right" });
      await expect(page.getByRole("menu", { name: "Actions for Highlights", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Edit tag", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Move up", exact: true })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Move down", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(highlightRow.locator(".sidebar-item")).toBeFocused();
      await page.getByRole("button", { name: "Actions for Highlights", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit tag", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit tag", exact: true });
      await edit.getByRole("textbox", { name: "Tag name" }).fill("Matches");
      await edit.getByRole("button", { name: "Icon: game", exact: true }).click();
      await edit.getByRole("button", { name: "Color Mint", exact: true }).click();
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories[0])
         .toEqual({ ...original, name: "Matches", color: "#73c6a1", icon: "game" });
      const categoryActions = page.getByRole("button", { name: "Actions for Matches", exact: true });
      await page.locator(".category-item").filter({ hasText: "Matches" }).hover();
      await categoryActions.click();
      await expect(page.getByRole("menuitem", { name: "Edit tag", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Delete tag", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(categoryActions).toBeFocused();
      await categoryActions.press("ArrowDown");
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Matches/ })).toBeFocused();
      await page.reload();
      await expect(page.locator(".recording-page")).toBeVisible();
      await focusNavigation();
      await page.keyboard.press("Control+2");
      await expect(page.getByRole("button", { name: /Matches/ }).first()).toBeVisible();
      await expect(sectionLabels).toHaveText(["Tags", "Applications", "Folders"]);
      await expect(page.getByRole("button", { name: "List view", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Grid view", exact: true }).click();
      await expect(page.getByRole("button", { name: "Grid view", exact: true })).toHaveAttribute("aria-pressed", "true");
      for (const name of ["Second", "Third"]) {
         await page.getByRole("button", { name: "New tag", exact: true }).click();
         const editor = page.getByRole("dialog", { name: "New tag", exact: true });
         await editor.getByRole("textbox", { name: "Tag name" }).fill(name);
         await editor.getByRole("button", { name: "Create", exact: true }).click();
         await expect(editor).not.toBeVisible();
      }
      await page.locator(".category-item").filter({ hasText: "Second" }).hover();
      await page.getByRole("button", { name: "Actions for Second", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete tag", exact: true }).click();
      const confirmation = page.getByRole("dialog", { name: "Delete Second?", exact: true });
      await expect(confirmation.getByRole("button", { name: "Delete tag", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(confirmation.getByRole("button", { name: "Delete tag", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(confirmation).not.toBeVisible();
      await expect(page.locator(".category-item")).toHaveCount(3);
      const labels = page.locator(".category-item .sidebar-label");
      await expect(labels).toHaveText(["Matches", "Second", "Third"]);
      const third = page.locator(".category-item").filter({ hasText: "Third" });
      await expect
         .poll(() =>
            third.evaluate(
               (row) =>
                  row
                     .closest(".motion-list-item")!
                     .getAnimations({ subtree: true })
                     .filter((animation) => animation.playState === "running").length
            )
         )
         .toBe(0);
      const thirdBounds = (await third.boundingBox())!;
      const firstBounds = (await page.locator(".category-item").first().boundingBox())!;
      const grab = thirdBounds.height / 2;
      await page.mouse.move(thirdBounds.x + 60, thirdBounds.y + grab);
      await page.mouse.down();
      await page.mouse.move(firstBounds.x + 90, firstBounds.y + 7, { steps: 12 });
      await expect(labels).toHaveText(["Third", "Matches", "Second"]);
      // The row follows only Y, and the preview must not write metadata yet.
      await expect.poll(async () => Math.abs((await third.boundingBox())!.y - firstBounds.y)).toBeLessThan(2);
      expect(Math.abs((await third.boundingBox())!.x - thirdBounds.x)).toBeLessThan(1);
      await page.mouse.move(firstBounds.x + 90, 0, { steps: 8 });
      const tagListBounds = (await third.locator("xpath=ancestor::div[@class='motion-list'][1]").boundingBox())!;
      expect((await third.boundingBox())!.y).toBeGreaterThanOrEqual(tagListBounds.y - 1);
      expect((await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name)).toEqual(["Matches", "Second", "Third"]);
      await page.mouse.up();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name))
         .toEqual(["Third", "Matches", "Second"]);
      await third.locator(".sidebar-item").click();
      await expect(third.locator(".sidebar-item")).toHaveAttribute("aria-pressed", "true");
      const movedBounds = (await third.boundingBox())!;
      const lastBounds = (await page.locator(".category-item").last().boundingBox())!;
      await page.mouse.move(movedBounds.x + 60, movedBounds.y + grab);
      await page.mouse.down();
      await page.mouse.move(lastBounds.x + 60, lastBounds.y + lastBounds.height - 5, { steps: 12 });
      await expect(labels).toHaveText(["Matches", "Second", "Third"]);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(labels).toHaveText(["Third", "Matches", "Second"]);
      expect((await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name)).toEqual(["Third", "Matches", "Second"]);
      const thirdControl = third.locator("[data-list-control]");
      await thirdControl.focus();
      await thirdControl.press("Alt+ArrowDown");
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name))
         .toEqual(["Matches", "Third", "Second"]);
      await expect(labels).toHaveText(["Matches", "Third", "Second"]);
      await expect(thirdControl).toBeFocused();
      await thirdControl.press("Alt+ArrowUp");
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name))
         .toEqual(["Third", "Matches", "Second"]);
      await expect(thirdControl).toBeFocused();
      await thirdControl.press("Alt+ArrowDown");
      await thirdControl.press("Alt+ArrowDown");
      await expect(labels).toHaveText(["Matches", "Second", "Third"]);
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name))
         .toEqual(["Matches", "Second", "Third"]);
      await thirdControl.press("Alt+ArrowUp");
      await thirdControl.press("Alt+ArrowUp");
      await expect(labels).toHaveText(["Third", "Matches", "Second"]);
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.map((item) => item.name))
         .toEqual(["Third", "Matches", "Second"]);
      await expect(thirdControl).toBeFocused();
      await page.getByRole("button", { name: "Recording", exact: true }).click();
      await expect(page.locator(".library-page")).toBeHidden();
      const tags = (await page.evaluate(() => window.acroClip.state())).categories;
      const secondId = tags.find((item) => item.name === "Second")!.id;
      const thirdId = tags.find((item) => item.name === "Third")!.id;
      // Real metadata updates while the retained page has no layout must not
      // turn zero offsets into the next visible animation's starting positions.
      await page.evaluate(({ id, before }) => window.acroClip.reorderCategory(id, before), { id: secondId, before: thirdId });
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await page.evaluate(({ id, before }) => window.acroClip.reorderCategory(id, before), { id: thirdId, before: secondId });
      await expect(labels).toHaveText(["Third", "Second", "Matches"]);
      const unchanged = page.locator(".category-item").filter({ hasText: "Matches" });
      expect(await unchanged.evaluate((row) => row.closest(".motion-list-item")!.getAnimations().length)).toBe(0);
      await page.locator(".category-item").filter({ hasText: "Second" }).hover();
      await page.getByRole("button", { name: "Actions for Second", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete tag", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Delete Second?", exact: true }).getByRole("button", { name: "Delete tag", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator(".category-item .sidebar-label")).toHaveText(["Third", "Matches"]);
      await page.keyboard.press("Control+,");
      await expect(page.locator(".settings-page")).toBeVisible();
      await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
      const binding = page.getByRole("button", { name: "Start / stop recording shortcut", exact: true });
      await binding.click();
      await expect(binding).toHaveText(/Press a shortcut/);
      expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+Shift+F5"))).toBe(false);
      await binding.press("Control+Alt+Shift+F4");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.shortcuts.toggleRecording).toBe("Control+Alt+Shift+F4");
      expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+Shift+F4"))).toBe(true);
      expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("Control+Alt+Shift+F5"))).toBe(true);
      const navigation = page.getByRole("button", { name: "Recording page shortcut", exact: true });
      await navigation.click();
      await expect(navigation).toHaveText(/Press a shortcut/);
      await navigation.press("Control+2");
      await expect(page.locator(".settings-save-feedback")).toContainText("same shortcut");
      expect((await page.evaluate(() => window.acroClip.state())).preferences.shortcuts.recording).toBeUndefined();
      await navigation.click();
      await expect(navigation).toHaveText(/Press a shortcut/);
      await navigation.press("Control+1");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.shortcuts.recording).toBe("Control+1");
      await page.keyboard.press("Control+1");
      await expect(page.locator(".recording-page")).toBeVisible();
      await expect(page.locator(".record-action kbd")).toHaveText("Ctrl + Alt + Shift + F4");
      await app.evaluate(({ ipcMain }) => {
         // An unavailable saved source is intentionally unlistenable. Exercise
         // audio error feedback with an explicitly available fixture instead.
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", () => [{ id: "window:0:0", kind: "app", name: "Fixture application", thumbnail: "" }]);
         ipcMain.removeHandler("preview-source");
         ipcMain.handle("preview-source", (_event, id) => {
            if (id) throw new Error("Fixture preview boundary");
         });
         ipcMain.removeHandler("listen-audio");
         ipcMain.handle("listen-audio", () => {
            throw new Error("The selected audio device is unavailable.");
         });
      });
      await page.reload();
      await expect(page.getByRole("button", { name: "Fixture application", exact: true })).toBeVisible();
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, captureAudio: true });
      });
      if (process.platform !== "win32") {
         await expect(page.getByRole("button", { name: "Listening is available on Windows only: Application", exact: true })).toBeDisabled();
         return;
      }
      const listen = page.getByRole("button", { name: "Listen to Application", exact: true });
      await listen.scrollIntoViewIfNeeded();
      await listen.focus();
      await listen.click();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".toast.error")).toBeVisible();
      await expect(page.locator(".mixer-monitor-error")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Listen to Application", exact: true })).toHaveAttribute("aria-pressed", "false");
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
   } catch (error) {
      failed = true;
      const page = app.windows()[0];
      if (page && !page.isClosed()) await page.screenshot({ path: test.info().outputPath("features-failure.png") }).catch(() => undefined);
      throw error;
   } finally {
      await app
         .context()
         .tracing.stop(failed ? { path: test.info().outputPath("browser-trace.zip") } : {})
         .catch(() => undefined);
      await app.close();
   }
});
