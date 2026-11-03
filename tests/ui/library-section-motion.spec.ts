import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

declare global {
   interface Window {
      librarySectionOffsets?: number[];
   }
}

test("tag removal keeps sibling sections in place and empty sections cannot fold", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-section-motion-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Library", exact: true }).click();
      const heading = page.getByRole("button", { name: "Tags", exact: true });
      const section = page.getByRole("region", { name: "Tags", exact: true });
      await expect(heading).not.toHaveAttribute("aria-expanded");
      await heading.click();
      await expect(section.locator(".sidebar-section-fold")).toHaveAttribute("data-open", "true");
      await expect(heading.locator("svg")).toHaveCount(0);
      await page.evaluate(async () => {
         for (const name of ["First", "Second", "Third"]) await window.acroClip.category("create", { name, color: "#b197fc" });
      });
      const settle = () =>
         expect
            .poll(() =>
               page
                  .locator(".sidebar-scroll")
                  .evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length)
            )
            .toBe(0);
      await expect(section.locator(".category-item")).toHaveCount(3);
      await settle();
      const remove = (name: string) =>
         page.evaluate(async (name) => {
            const category = (await window.acroClip.state()).categories.find((item) => item.name === name);
            if (!category) throw new Error(`Missing tag ${name}`);
            await window.acroClip.category("delete", { id: category.id });
         }, name);
      await remove("First");
      await expect(section.locator(".category-item")).toHaveCount(2);
      await settle();
      await page.evaluate(() => {
         window.librarySectionOffsets = [];
         new MutationObserver(() => {
            for (const row of document.querySelectorAll('.sidebar-scroll > .motion-list > .motion-list-item:not([data-motion-key="tags"])')) {
               for (const animation of row.getAnimations()) {
                  const frame = (animation.effect as KeyframeEffect).getKeyframes()[0];
                  const transform = frame?.["transform"];
                  if (typeof transform === "string") window.librarySectionOffsets?.push(new DOMMatrixReadOnly(transform).m42);
               }
            }
         }).observe(document.querySelector(".sidebar-scroll")!, { subtree: true, childList: true });
      });
      await remove("Second");
      await expect(section.locator(".category-item")).toHaveCount(1);
      await settle();
      expect(await page.evaluate(() => window.librarySectionOffsets)).toEqual([]);
      await section.locator(".sidebar-item").click();
      await expect(section.locator(".sidebar-item")).toHaveAttribute("aria-pressed", "true");
      await heading.click();
      await expect(heading).toHaveAttribute("aria-expanded", "false");
      await page.getByRole("textbox", { name: "Search clips", exact: true }).focus();
      await page.mouse.move(800, 500);
      await expect(heading.locator("svg")).toHaveCSS("opacity", "1");
      await remove("Third");
      await expect(heading).not.toHaveAttribute("aria-expanded");
      await expect(heading.locator("svg")).toHaveCount(0);
      await expect(section.locator(".sidebar-section-fold")).not.toHaveAttribute("inert");
      await page.evaluate(() => window.acroClip.category("create", { name: "New tag", color: "#b197fc" }));
      await expect(heading).toHaveAttribute("aria-expanded", "true");
   } finally {
      await app.close();
   }
});
