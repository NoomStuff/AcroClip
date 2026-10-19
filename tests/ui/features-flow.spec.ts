import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultPreferences } from "../../src/shared/defaults";
test("category appearance, local shortcuts, conflicts and global capture bindings persist", async () => {
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
   try {
      const page = await app.firstWindow();
      await expect(page.locator(".recording-page")).toBeVisible();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("button", { name: "Recording", exact: true }).click();
      const marker = async () => {
         await page.getByRole("button", { name: "Library", exact: true }).evaluate((node) => {
            const probe = { values: [] as number[], done: false };
            (window as unknown as { tabProbe: typeof probe }).tabProbe = probe;
            const started = performance.now();
            const tick = () => {
               const marker = node.querySelector<HTMLElement>(".rail-marker");
               if (marker) probe.values.push(new DOMMatrixReadOnly(getComputedStyle(marker).transform).m22);
               if (performance.now() - started < 700) requestAnimationFrame(tick);
               else probe.done = true;
            };
            requestAnimationFrame(tick);
         });
         await page.keyboard.press("Control+2");
         await expect.poll(() => page.evaluate(() => (window as unknown as { tabProbe: { done: boolean } }).tabProbe.done)).toBe(true);
         const values = await page.evaluate(() => (window as unknown as { tabProbe: { values: number[] } }).tabProbe.values);
         expect(Math.min(...values)).toBeLessThan(0.35);
         expect(values.at(-1)).toBeCloseTo(1, 2);
         console.log("Stationary tab marker scaleY", { first: values[0], max: Math.max(...values), last: values.at(-1) });
      };
      await marker();
      await page.keyboard.press("Control+1");
      await marker();
      await page.keyboard.press("Control+1");
      await page.keyboard.press("Control+2");
      await expect(page.locator(".library-page")).toBeVisible();
      await page.keyboard.press("Control+f");
      const search = page.getByRole("textbox", { name: "Search clips", exact: true });
      await expect(search).toBeFocused();
      await search.fill("typing");
      await search.press("Control+1");
      await expect(page.locator(".library-page")).toBeVisible();
      await search.clear();
      await search.blur();
      await expect(page.getByRole("button", { name: "New category", exact: true })).toHaveCount(1);
      await page.keyboard.press("Control+Shift+n");
      const category = page.getByRole("dialog", { name: "New category", exact: true });
      await expect(category).toBeVisible();
      await category.getByRole("textbox", { name: "Category name" }).fill("Highlights");
      await category.getByRole("button", { name: "More category icons", exact: true }).click();
      await page.getByRole("menuitemradio", { name: "Icon: rocket", exact: true }).click();
      await category.getByLabel("Custom category color").fill("#112233");
      await page.screenshot({ path: "test-results/category-custom.png" });
      await category.getByRole("button", { name: "Create", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).categories.length).toBe(1);
      const original = (await page.evaluate(() => window.acroClip.state())).categories[0]!;
      expect(original).toMatchObject({ name: "Highlights", color: "#112233", icon: "rocket" });
      await page.getByRole("button", { name: "Actions for Highlights", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit category", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit category", exact: true });
      await edit.getByRole("textbox", { name: "Category name" }).fill("Matches");
      await edit.getByRole("button", { name: "Icon: game", exact: true }).click();
      await edit.getByRole("button", { name: "Color #73c6a1", exact: true }).click();
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).categories[0])
         .toEqual({ ...original, name: "Matches", color: "#73c6a1", icon: "game" });
      await page.reload();
      await expect(page.locator(".recording-page")).toBeVisible();
      await page.keyboard.press("Control+2");
      await expect(page.getByRole("button", { name: /Matches/ }).first()).toBeVisible();
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
      await page.screenshot({ path: "test-results/shortcuts-expanded.png" });
      const navigation = page.getByRole("button", { name: "Recording page shortcut", exact: true });
      await navigation.click();
      await expect(navigation).toHaveText(/Press a shortcut/);
      await navigation.press("Control+2");
      await expect(page.locator(".settings-save-feedback")).toContainText("same shortcut");
      expect((await page.evaluate(() => window.acroClip.state())).preferences.shortcuts.recording).toBeUndefined();
      await navigation.click();
      await navigation.press("Control+1");
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.shortcuts.recording).toBe("Control+1");
      await page.keyboard.press("Control+1");
      await expect(page.locator(".recording-page")).toBeVisible();
      await expect(page.locator(".record-action kbd")).toHaveText("Ctrl + Alt + Shift + F4");
      expect(await page.locator(".record-action kbd").evaluate((node) => getComputedStyle(node).position)).toBe("absolute");
      const mixerPositions = () =>
         page.locator(".mixer-channel").evaluateAll((nodes) =>
            nodes.map((node) => {
               const bounds = node.getBoundingClientRect();
               return {
                  top: Math.round((bounds.top - node.closest(".mixer")!.getBoundingClientRect().top) * 100) / 100,
                  height: Math.round(bounds.height * 100) / 100,
               };
            })
         );
      const beforeAudio = await mixerPositions();
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, captureAudio: true });
      });
      await expect.poll(mixerPositions).toEqual(beforeAudio);
      const listen = page.getByRole("button", { name: "Listen to Source audio", exact: true });
      // Focus can scroll the mixer before the click. Measure error feedback after that normal navigation.
      await listen.scrollIntoViewIfNeeded();
      await listen.focus();
      const beforeListen = await mixerPositions();
      await listen.click();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".toast.error")).toBeVisible();
      await expect(page.locator(".mixer-monitor-error")).toHaveCount(0);
      await expect.poll(mixerPositions).toEqual(beforeListen);
      await page.screenshot({ path: "test-results/audio-status-error.png" });
      await expect(page.getByRole("button", { name: "Listen to Source audio", exact: true })).toHaveAttribute("aria-pressed", "false");
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
   } finally {
      await app.close();
   }
});
