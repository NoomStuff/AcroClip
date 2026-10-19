import type {} from "./fixtures/slider-motion/entry";
import { test, expect, _electron as electron } from "@playwright/test";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("slider visuals chase repeated targets in one loop without restarting or double easing", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-slider-motion-")),
      output = join(profile, "renderer");
   await build({
      configFile: false,
      root: resolve("tests/ui/fixtures/slider-motion"),
      base: "./",
      plugins: [react()],
      build: { outDir: output, emptyOutDir: true },
      logLevel: "error",
   });
   const app = await electron.launch({
      args: [resolve("tests/ui/fixtures/slider-motion/main.mjs")],
      env: { ...process.env, ACROCLIP_PROFILE: profile, ACROCLIP_SLIDER_FIXTURE: join(output, "index.html") },
   });
   try {
      const page = await app.firstWindow();
      const generic = page.getByRole("slider", { name: "Generic", exact: true }),
         gain = page.getByRole("slider", { name: "Gain", exact: true });
      await expect(generic).toBeVisible();
      const root = page.locator(".slider");
      const marks = await root.locator(".slider-marker").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.left));
      expect(marks).toEqual(["25%", "50%", "75%"]);
      const thumb = root.locator(".slider-thumb");
      await expect(thumb).toHaveCSS("box-shadow", "none");
      const hoverBox = (await generic.boundingBox())!;
      await page.mouse.move(0, 0);
      await generic.evaluate((node) => (node as HTMLElement).blur());
      await page.waitForTimeout(400);
      const hovering = generic.evaluate(async (node) => {
         const control = node.closest(".slider-control")!;
         const thumb = control.querySelector(".slider-thumb")!;
         const result: number[] = [];
         control.dispatchEvent(new PointerEvent("pointerenter"));
         for (let i = 0; i < 35; i++) {
            await new Promise(requestAnimationFrame);
            result.push(thumb.getBoundingClientRect().width);
         }
         return result;
      });
      await page.screenshot({ path: "test-results/slider-hover-start.png" });
      await page.waitForTimeout(80);
      await page.screenshot({ path: "test-results/slider-hover-mid.png" });
      const widths = await hovering;
      expect(Math.max(...widths)).toBeGreaterThan(13);
      expect(Math.max(...widths)).toBeLessThan(13.5);
      await expect.poll(() => thumb.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(13, 1);
      await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
      await page.screenshot({ path: "test-results/slider-hover-end.png" });
      for (let i = 0; i < 12; i++) await page.mouse.move(i % 2 ? 0 : hoverBox.x + hoverBox.width / 2, i % 2 ? 0 : hoverBox.y + hoverBox.height / 2);
      await page.mouse.move(0, 0);
      await expect.poll(() => thumb.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(10, 1);
      await generic.press("Home");
      await expect(generic).toHaveValue("0");
      await generic.press("End");
      await expect(generic).toHaveValue("100");
      await generic.evaluate((node) => (node as HTMLElement).blur());
      await page.waitForTimeout(400);
      await page.evaluate(() => {
         window.motionProbe.samples = [];
      });

      // 250 Hz updates exceed display refresh. Input values change synchronously;
      // the visual loop retains its previous frame timestamp and current position.
      await page.evaluate(async () => {
         const input = document.querySelector<HTMLInputElement>('.slider input[type="range"]')!;
         const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
         for (let index = 0; index < 120; index++) {
            set.call(input, String(index < 60 ? index * 1.5 : 180 - index * 1.5));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 4));
         }
      });
      await expect.poll(() => page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
      const frames = await page.evaluate(() => window.motionProbe.samples.filter((sample) => sample.kind === "Generic"));
      expect(frames.length).toBeGreaterThan(20);
      const errors: number[] = [];
      for (let index = 2; index < frames.length; index++) {
         const previous = frames[index - 1]!,
            current = frames[index]!;
         const dt = Math.min((current.time - previous.time) / 1000, 0.1);
         // A fresh target can reach React after the preceding paint. Bound its
         // expected step by both adjacent observed targets at continuous speed.
         const rates = [previous.target, current.target].map((target) => previous.position + (target - previous.position) * (1 - Math.exp(-18 * dt)));
         errors.push(Math.max(0, Math.min(...rates) - current.position, current.position - Math.max(...rates)));
         expect(Math.abs(current.fill - current.position)).toBeLessThan(0.03);
         expect(Math.abs(current.thumb - current.position)).toBeLessThan(0.03);
      }
      expect(Math.max(...errors)).toBeLessThan(0.15);
      console.log("Continuous slider rendered frames", { frames: frames.length, maxStepErrorPercent: Math.max(...errors) });
      await page.getByRole("checkbox", { name: "Delayed preferences" }).check();
      // Real pointer dragging, unity snapping and exact Shift bypass.
      const box = (await gain.boundingBox())!;
      await page.mouse.move(box.x + 6, box.y + box.height / 2);
      await page.mouse.down();
      for (let index = 1; index <= 80; index++) await page.mouse.move(box.x + 6 + ((box.width - 12) * index) / 80, box.y + box.height / 2);
      await page.mouse.up();
      await expect(gain).toHaveValue("1.41");
      await page.waitForTimeout(500);
      await expect(gain).toHaveValue("1.41");
      await expect.poll(() => page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
      const gainFrames = await page.evaluate(() => window.motionProbe.samples.filter((sample) => sample.kind === "Gain"));
      expect(gainFrames.length).toBeGreaterThan(20);
      for (const current of gainFrames) {
         expect(Math.abs(current.fill - current.position)).toBeLessThan(0.03);
         expect(Math.abs(current.thumb - current.position)).toBeLessThan(0.03);
      }
      await gain.press("Home");
      await gain.press("End");
      await gain.press("Delete");
      await expect(gain).toHaveValue("1");
      const number = page.getByRole("textbox", { name: "Gain in decibels" });
      await number.fill("+12");
      await number.press("Enter");
      await expect(number).toHaveValue("+12.0");
      await expect(gain).toHaveValue("1.41");
      await page.getByRole("spinbutton", { name: "Generic value" }).fill("25");
      await page.getByRole("spinbutton", { name: "Generic value" }).press("Enter");
      await expect(generic).toHaveValue("25");
      await expect(page.locator("#values")).toHaveText("25,3.98");
      await page.getByRole("button", { name: "External update" }).click();
      await expect(generic).toHaveValue("75");
      await expect(gain).toHaveValue("0.8");
      await expect.poll(() => root.evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue("--slider-position")))).toBe(75);
      const tabs = page.getByRole("group", { name: "Motion tabs" });
      await page.evaluate(() => {
         window.motionProbe.selectionSamples = [];
      });
      const start = await tabs
         .getByRole("button", { name: "First" })
         .evaluate((node) => node.getBoundingClientRect().left - node.parentElement!.getBoundingClientRect().left);
      await tabs.getByRole("button", { name: "Last" }).click();
      await expect.poll(() => page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
      const selection = await page.evaluate(() => window.motionProbe.selectionSamples);
      expect(selection.length).toBeGreaterThan(15);
      const target = selection.at(-1)!.target;
      expect(Math.max(...selection.map((frame) => frame.x))).toBeGreaterThan(target + 0.2);
      for (const frame of selection) {
         expect(frame.x).toBeGreaterThanOrEqual(Math.min(start, target) - 5.1);
         expect(frame.x).toBeLessThanOrEqual(Math.max(start, target) + 5.1);
         expect(frame.x + frame.width).toBeLessThanOrEqual(frame.parentWidth + 0.2);
         expect(Math.abs(frame.width - frame.targetWidth)).toBeLessThan(0.1);
         expect(Math.abs(frame.height - frame.targetHeight)).toBeLessThan(0.1);
      }
      await page.evaluate(() => {
         window.motionProbe.selectionSamples = [];
      });
      for (let index = 0; index < 12; index++) {
         await page.getByRole("slider", { name: "Bar width" }).fill(String(900 - index * 40));
         if (index % 3 === 0) await tabs.getByRole("button", { name: index % 2 ? "Last" : "First" }).click();
         await page.waitForTimeout(20);
      }
      const resized = await page.evaluate(() => window.motionProbe.resizeSamples);
      expect(resized.length).toBeGreaterThan(10);
      for (const frame of resized) {
         expect(Math.abs(frame.width - frame.targetWidth)).toBeLessThan(0.1);
         expect(Math.abs(frame.height - frame.targetHeight)).toBeLessThan(0.1);
         expect(frame.x + frame.width).toBeLessThanOrEqual(frame.parentWidth + 0.2);
      }
      console.log("Bounded selection rendered frames", {
         selectionFrames: selection.length,
         overshootPx: Math.max(...selection.map((frame) => frame.x)) - target,
         resizeFrames: resized.length,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await generic.fill("10");
      expect(await root.evaluate((node) => parseFloat((node as HTMLElement).style.getPropertyValue("--slider-position")))).toBe(10);
      expect(await page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await generic.fill("100");
      await page.getByRole("button", { name: "Toggle controls" }).click();
      expect(await page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
      await page.waitForTimeout(60);
      expect(await page.evaluate(() => window.motionProbe.pending.size)).toBe(0);
   } finally {
      await app.close();
   }
});
