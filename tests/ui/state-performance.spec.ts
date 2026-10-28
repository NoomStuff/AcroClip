import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type { AppEvent, AppState, Clip } from "../../src/shared/types";

test("incremental updates preserve large libraries, meter routing, visibility and reload", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-state-performance-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, autoRecord: false }));
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).collectionStatus.phase)).toBe("ready");
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).windowVisible)).toBe(true);
      const actual = await page.evaluate(() => window.acroClip.state());
      await app.evaluate(({ BrowserWindow, ipcMain }) => {
         const web = BrowserWindow.getAllWindows()[0]!.webContents;
         const publish = web.send.bind(web);
         (globalThis as typeof globalThis & { publishPerformance?: (event: AppEvent) => void }).publishPerformance = (event) => publish("app-event", event);
         web.send = (channel, ...args) => {
            if (channel === "app-event" && ["state", "state-patch", "recorder", "audio-levels", "audio-monitor"].includes((args[0] as AppEvent).type)) return;
            publish(channel, ...args);
         };
         ipcMain.removeHandler("monitor-audio");
         ipcMain.handle("monitor-audio", () => []);
      });
      const publish = (event: AppEvent) =>
         app.evaluate((_electron, event) => {
            (globalThis as typeof globalThis & { publishPerformance?: (event: AppEvent) => void }).publishPerformance?.(event);
         }, event);
      const state: AppState = {
         ...actual,
         preferences: { ...actual.preferences, audioSources: actual.preferences.audioSources.map((source) => ({ ...source, muted: false, enabled: true })) },
      };
      await publish({ type: "state", state });
      const sourceMeter = page.getByRole("meter", { name: "Source audio peak", exact: true });
      const microphoneMeter = page.getByRole("meter", { name: "Microphone peak", exact: true });
      await expect(sourceMeter).toBeVisible();
      await publish({ type: "audio-levels", levels: { capture: 85, microphone: 0, additional: { "microphone-default": 32, "source-audio": 5 } } });
      await expect.poll(async () => Number(await sourceMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(-15);
      await expect.poll(async () => Number(await microphoneMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(-45);
      await publish({ type: "audio-levels", levels: { capture: 85, microphone: 0, additional: {} } });
      await expect.poll(async () => Number(await microphoneMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(-45);
      await publish({
         type: "state-patch",
         patch: {
            preferences: {
               ...state.preferences,
               audioSources: state.preferences.audioSources.map((source) => ({ ...source, muted: source.kind === "source" })),
            },
         },
      });
      await expect(sourceMeter).toHaveAttribute("aria-valuenow", "-60");
      await expect.poll(async () => Number(await microphoneMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(-45);

      state.clips = Array.from({ length: 1000 }, (_, index): Clip => ({
         id: `clip-${index}`,
         name: `Moment ${index}`,
         path: join(collection, `clip-${index}.mp4`),
         relativePath: `clip-${index}.mp4`,
         source: "Game",
         size: 1000000,
         duration: 30,
         width: 640,
         height: 360,
         createdAt: index,
         thumbnail: "",
         playbackUrl: "",
         categories: index % 2 ? ["saved"] : [],
         tracks: [],
         shareables: [],
      }));
      state.categories = [{ id: "saved", name: "Saved", color: "#abcdef" }];
      await publish({ type: "state-patch", patch: { clips: state.clips, categories: state.categories } });
      await expect(page.locator(".clip-card")).toHaveCount(0);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-card")).toHaveCount(1000);
      await expect(page.getByRole("button", { name: /^Saved\s*500$/ })).toBeVisible();
      await page.getByRole("textbox", { name: "Search clips", exact: true }).fill("Moment 999");
      await expect(page.locator(".clip-card")).toHaveCount(1);
      const clip = page.getByRole("button", { name: "Open Moment 999", exact: true });
      await expect(clip).toBeVisible();
      await clip.focus();
      await publish({
         type: "state-patch",
         patch: {
            storageWarning: "Low storage in clip folder",
            jobs: [{ id: "job", clipId: "clip-999", kind: "shareable", state: "running", progress: 0.5, message: "Creating shareable" }],
         },
      });
      await expect(clip).toBeFocused();
      await expect(page.locator(".card-job")).toContainText("50%");
      await expect(page.getByText("Low storage in clip folder", { exact: true })).toBeVisible();
      await publish({ type: "state-patch", patch: { storageWarning: "", jobs: [] } });
      await expect(page.locator(".card-job")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Search clips", exact: true })).toHaveValue("Moment 999");
      await page.getByRole("button", { name: "Recording", exact: true }).click();
      await expect(sourceMeter).toHaveAttribute("data-muted", "true");
      await publish({ type: "state-patch", patch: { preferences: state.preferences } });
      await expect(sourceMeter).not.toHaveAttribute("data-muted", "true");
      await publish({ type: "audio-levels", levels: { capture: 40, microphone: 0, additional: {} } });
      await expect.poll(async () => Number(await sourceMeter.getAttribute("aria-valuenow"))).toBeGreaterThan(-42);
      await expect(microphoneMeter).toHaveAttribute("aria-valuenow", "-60");
      await page.reload();
      await expect(page.getByRole("button", { name: "Recording", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".mixer-channel")).toHaveCount(2);
   } finally {
      await app.close();
   }
});
