import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
import { mediaTool } from "./media-tool";
import { textEvidence } from "./visual-review-evidence";

test("visual review covers primary screens and settings at narrow widths", async () => {
   test.setTimeout(180000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-visual-review-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   const video = join(collection, "Overtime comeback.mp4");
   await promisify(execFile)(mediaTool("ffmpeg"), [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "2",
      "-c:a",
      "aac",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      video,
   ]);
   await copyFile(video, join(collection, "A very long clip name that should stay readable in the library.mp4"));
   await copyFile(video, join(collection, "Last round.mp4"));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
      })
   );
   await writeFile(
      join(profile, "game-catalog.json"),
      JSON.stringify({
         updated: Date.now(),
         entries: [
            { id: "celeste", name: "Celeste", executables: [{ name: "celeste.exe", os: process.platform }] },
            { id: "stardew", name: "Stardew Valley", executables: [{ name: "stardew.exe", os: process.platform }] },
         ],
      })
   );
   const app = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile, ACROCLIP_COLLECTION: collection },
   });
   try {
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const mainWindowId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id);
      let captureWidth = 1280;
      const resize = async (width: number) => {
         captureWidth = width;
         await app.evaluate(
            ({ BrowserWindow }, { id, width }) => {
               const window = BrowserWindow.fromId(id)!;
               window.unmaximize();
               window.setMinimumSize(0, 0);
               window.setContentSize(width, 800);
            },
            { id: mainWindowId, width }
         );
         await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height: 800 });
      };
      await resize(1280);
      await page.evaluate(() => document.fonts.ready);
      const evidence = process.env["ACROCLIP_UI_EVIDENCE"];
      const capture = async (name: string) => {
         if (!evidence) return;
         await mkdir(evidence, { recursive: true });
         expect(await page.evaluate(() => innerWidth), `${name} capture width`).toBe(captureWidth);
         await page.evaluate(() => document.fonts.ready);
         await page.screenshot({ path: join(evidence, `${name}.png`), animations: "disabled", scale: "css" });
         const text = await textEvidence(page);
         await writeFile(join(evidence, `${name}.json`), JSON.stringify({ width: captureWidth, height: 800, text }, null, 2));
         expect(
            text.filter((sample) => sample.contrast < 4.5),
            `${name} sampled UI text clears 4.5:1`
         ).toEqual([]);
      };
      await expect(page.locator(".recording-page")).toBeVisible();
      if (process.env["ACROCLIP_NATIVE_UI"] === "1") {
         await app.evaluate(async ({ BrowserWindow }) => {
            const fixture = new BrowserWindow({ title: "Capture reference", width: 800, height: 450, show: false, backgroundColor: "#274955" });
            await fixture.loadURL(
               `data:text/html,${encodeURIComponent('<html><title>Capture reference</title><body style="margin:0;background:#274955;color:#d9eee8;font:24px sans-serif"><div style="padding:48px">Capture reference<div style="margin-top:32px;height:140px;background:#396873;border-radius:12px"></div><div id="time" style="margin-top:24px"></div></div><script>setInterval(()=>document.getElementById("time").textContent=new Date().toLocaleTimeString(),1000)</script></body></html>')}`
            );
            fixture.showInactive();
            BrowserWindow.getAllWindows()
               .find((window) => window.getTitle() !== "Capture reference")!
               .focus();
         });
         await expect.poll(() => page.evaluate(async () => (await window.acroClip.sources()).some((source) => source.name === "Capture reference"))).toBe(true);
         await page.evaluate(async () => {
            const source = (await window.acroClip.sources()).find((item) => item.name === "Capture reference")!;
            const state = await window.acroClip.state();
            await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "app", sourceId: source.id, allowSoftwareEncoder: true });
         });
         await expect(page.locator(".preview-note")).toHaveText("Live preview");
      }
      await page.evaluate(async () => {
         await window.acroClip.category("create", { name: "Highlights", color: "#b197fc", icon: "star" });
         await window.acroClip.category("create", { name: "Funny moments", color: "#8dccaa", icon: "smile" });
         await window.acroClip.createFolder("", "Saved moments");
      });
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).clips.some((clip) => clip.name === "Overtime comeback"))).toBe(true);
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         const clip = state.clips.find((clip) => clip.name === "Overtime comeback")!;
         await window.acroClip.category("assign", { clipId: clip.id, categoryIds: state.categories.map((category) => category.id) });
      });
      for (const width of [1280, 980]) {
         await resize(width);
         await page.getByRole("button", { name: "Recording", exact: true }).click();
         if (process.env["ACROCLIP_NATIVE_UI"] === "1") {
            await expect(page.locator(".preview-note")).toHaveText("Live preview");
            await expect(page.locator(".preview-stream")).toHaveClass(/ready/);
         }
         await capture(`recording-${width}`);
         if (width === 1280 && process.env["ACROCLIP_NATIVE_UI"] === "1") {
            await page.getByRole("button", { name: "Start recording", exact: true }).click();
            await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).recorder.state)).toBe("recording");
            await expect
               .poll(() => page.evaluate(async () => (await window.acroClip.state()).recorder.availableSeconds), { timeout: 15000 })
               .toBeGreaterThanOrEqual(1);
            await expect(page.getByRole("button", { name: "Save clip", exact: true })).toBeEnabled();
            await capture("recording-active");
            await page.getByRole("button", { name: "Stop recording", exact: true }).click();
         }
         await page.getByRole("button", { name: "Library", exact: true }).click();
         await page.getByRole("button", { name: "Grid view", exact: true }).click();
         await expect(page.getByRole("button", { name: "Open Overtime comeback", exact: true })).toBeVisible();
         await expect(page.locator(".clip-thumbnail img").first()).toBeVisible();
         await capture(`library-grid-${width}`);
         if (evidence && width === 1280) {
            const session = await app.context().newCDPSession(page);
            await session.send("DOM.enable");
            await session.send("CSS.enable");
            const { root } = await session.send("DOM.getDocument");
            const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".library-heading h1" });
            const fonts = await session.send("CSS.getPlatformFontsForNode", { nodeId });
            await writeFile(join(evidence, "rendered-fonts.json"), JSON.stringify(fonts, null, 2));
            await session.detach();
         }
         await page.getByRole("button", { name: "List view", exact: true }).click();
         await capture(`library-list-${width}`);
         const search = page.getByRole("textbox", { name: "Search clips", exact: true });
         await search.fill("No matching moment");
         await capture(`library-empty-${width}`);
         await search.clear();
         await page.getByRole("button", { name: "Open Overtime comeback", exact: true }).click({ button: "right" });
         await expect(page.getByRole("menu", { name: "Actions for Overtime comeback", exact: true })).toBeVisible();
         await capture(`clip-menu-${width}`);
         await page.keyboard.press("Escape");
         await page.getByRole("button", { name: "New tag", exact: true }).click();
         await expect(page.getByRole("dialog", { name: "New tag", exact: true })).toBeVisible();
         await page.getByRole("textbox", { name: "Tag name", exact: true }).fill("Best moments");
         await capture(`tag-dialog-${width}`);
         await page.keyboard.press("Escape");
         await page.getByRole("button", { name: "Open Overtime comeback", exact: true }).click();
         await expect(page.locator(".viewer-main video")).toBeVisible();
         await expect.poll(() => page.locator(".viewer-main video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
         await page.locator(".viewer-main video").evaluate((video: HTMLVideoElement) => video.pause());
         await page.locator(".player-controls").hover();
         await capture(`viewer-${width}`);
         const playback = page.locator(".viewer-main video");
         const playbackSource = await playback.getAttribute("src");
         await page.getByRole("button", { name: "Show file details", exact: true }).click();
         await expect(page.getByRole("heading", { name: "File details", exact: true })).toBeVisible();
         await expect(playback).toHaveAttribute("src", playbackSource!);
         await capture(`viewer-details-${width}`);
         await page.getByRole("button", { name: "Hide file details", exact: true }).click();
         await page.getByRole("combobox", { name: /Shareable size:/ }).click();
         await capture(`viewer-size-menu-${width}`);
         await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      for (const width of [1280, 980, 760]) {
         await resize(width);
         for (const section of ["Recording", "Collection", "Games", "Notifications", "Shortcuts", "App & updates"]) {
            await page.locator(".settings-nav").getByRole("button", { name: section, exact: true }).click();
            await expect(page.locator(".settings-heading")).toHaveText(section);
            if (section === "Games") {
               await expect(page.locator(".game-list > li")).toHaveCount(2);
               const overflowingGames = await page
                  .locator(".game-list > li")
                  .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length);
               expect(overflowingGames, `Game rows fit at ${width}px`).toBe(0);
            }
            if (section === "Recording") {
               await expect(page.getByRole("combobox", { name: "Resolution limit", exact: true })).toHaveAccessibleDescription(
                  "Screens scale to this limit. Apps keep their original size."
               );
               await expect(page.getByRole("slider", { name: "Recording compression", exact: true })).toHaveAccessibleDescription(
                  "Lower values keep more detail and use more space."
               );
               await expect(page.getByRole("spinbutton", { name: "Recording compression value", exact: true })).toHaveAccessibleDescription(
                  "Lower values keep more detail and use more space."
               );
               await expect(page.getByRole("spinbutton", { name: "Clip length", exact: true })).toHaveAccessibleDescription(
                  "Save this much recent footage when you clip."
               );
            }
            await capture(`settings-${section.toLowerCase().replaceAll(/[^a-z]+/g, "-")}-${width}`);
            const overflow = await page.locator(".settings-body").evaluate((element) => element.scrollWidth - element.clientWidth);
            expect(overflow, `${section} fits at ${width}px`).toBeLessThanOrEqual(1);
            const escapedControls = await page.locator(".settings-row.field").evaluateAll((rows) =>
               rows.flatMap((row) => {
                  const control = row.querySelector<HTMLElement>(".field-control");
                  const copy = row.querySelector<HTMLElement>(".field-copy");
                  if (!control || !copy) return [];
                  const bounds = row.getBoundingClientRect();
                  const input = control.getBoundingClientRect();
                  const text = copy.getBoundingClientRect();
                  const overlap = input.top < text.bottom && input.bottom > text.top && input.left < text.right;
                  return input.right > bounds.right + 1 || input.left < bounds.left - 1 || overlap ? [copy.textContent] : [];
               })
            );
            expect(escapedControls, `${section} controls stay inside their rows without overlapping labels at ${width}px`).toEqual([]);
         }
      }
      if (evidence) {
         await resize(1280);
         const exportSource = join(collection, "Tournament final.mp4");
         await promisify(execFile)(mediaTool("ffmpeg"), [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30",
            "-t",
            "8",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "16",
            "-threads",
            "1",
            exportSource,
         ]);
         await page.evaluate(async () => {
            const state = await window.acroClip.state();
            await window.acroClip.savePreferences({ ...state.preferences, shareSizeMB: 1 });
            await window.acroClip.refresh();
         });
         await page.getByRole("button", { name: "Library", exact: true }).click();
         await page.getByRole("button", { name: "Open Tournament final", exact: true }).click();
         await expect(page.getByRole("button", { name: "Create shareable", exact: true })).toBeEnabled();
         await capture("viewer-ready-to-share");
         await page.getByRole("button", { name: "Create shareable", exact: true }).click();
         await expect(page.getByRole("button", { name: /Creating shareable|Waiting to create shareable/ })).toBeVisible();
         await capture("viewer-export-progress");
         await expect
            .poll(() => page.evaluate(async () => (await window.acroClip.state()).clips.find((clip) => clip.name === "Tournament final")?.shareables.length), {
               timeout: 60000,
            })
            .toBe(1);
         await page.getByRole("button", { name: "Shareable", exact: true }).click();
         await expect.poll(() => page.locator(".viewer-main video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
         await page.getByRole("button", { name: "Show file details", exact: true }).click();
         await capture("viewer-shareable");
      }
      await resize(980);
      const emptyCollection = join(profile, "empty-collection");
      await mkdir(emptyCollection);
      await page.evaluate(async (collection) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, collection });
      }, emptyCollection);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.getByRole("heading", { name: "No clips", exact: true })).toBeVisible();
      await capture("library-empty-collection");
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, setupComplete: false });
      });
      await page.reload();
      await expect(page.locator(".onboarding")).toBeVisible();
      await capture("onboarding-capture");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Save a moment", exact: true })).toBeVisible();
      await capture("onboarding-clip");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "You're good to go", exact: true })).toBeVisible();
      await capture("onboarding-ready");
   } finally {
      await app.close();
   }
});
