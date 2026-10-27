import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultPreferences } from "../../src/shared/defaults";
import type { AppState } from "../../src/shared/types";

test("cached loading states, enumeration retry, and interrupted library movement", async () => {
   test.setTimeout(120000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-loading-ui-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   const source = join(collection, "First.mp4");
   await promisify(execFile)(
      resolve("resources/media/ffmpeg.exe"),
      ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-t", "1", "-c:v", "libx264", "-threads", "1", source],
      { windowsHide: true }
   );
   for (const name of ["Second", "Third", "Fourth", "Fifth", "Sixth"]) await copyFile(source, join(collection, `${name}.mp4`));
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F10",
      })
   );
   const started = performance.now();
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).collectionStatus?.phase, { timeout: 15000 }).toBe("ready");
      const openedMs = performance.now() - started;
      const actual = await page.evaluate(() => window.acroClip.state());
      await app.evaluate(({ BrowserWindow }) => {
         const web = BrowserWindow.getAllWindows()[0]!.webContents;
         const publish = web.send.bind(web);
         (globalThis as typeof globalThis & { publishFixture?: (snapshot: unknown) => void }).publishFixture = (snapshot) =>
            publish("app-event", { type: "state", state: snapshot });
         web.send = (channel, ...args) => {
            if (channel === "app-event" && (args[0] as { type?: string })?.type === "state") return;
            publish(channel, ...args);
         };
      });
      const send = async (value: AppState) =>
         app.evaluate((_electron, snapshot) => {
            (globalThis as typeof globalThis & { publishFixture?: (snapshot: unknown) => void }).publishFixture?.(snapshot);
         }, value);
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(page.locator(".clip-card")).toHaveCount(6);
      await page.getByRole("button", { name: "Collection actions", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "Refresh collection", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      const refreshStart = performance.now();
      await page.evaluate(() => window.acroClip.refresh());
      const refreshMs = performance.now() - refreshStart;
      const sourceStart = performance.now();
      const available = await page.evaluate(() => window.acroClip.sources());
      const sourceMs = performance.now() - sourceStart;
      const cachedStart = performance.now();
      await page.evaluate(() => window.acroClip.sources());
      console.log("Loading measurements", {
         openedMs,
         refreshMs,
         sourceMs,
         cachedSourceMs: performance.now() - cachedStart,
         clips: actual.clips.length,
         sources: available.length,
      });
      await send({
         ...actual,
         clips: [],
         collectionStatus: { root: collection, phase: "loading", discovery: { videos: 114, byFolder: { "": 114 }, complete: true } },
      });
      await expect(page.getByLabel("Opening collection")).toBeVisible();
      await expect(page.locator(".clip-placeholder")).toHaveCount(114);
      await expect(page.getByText("114 videos found", { exact: true })).toBeVisible();
      await expect(page.getByText("No clips", { exact: true })).toHaveCount(0);
      await page.waitForTimeout(400);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1380, 900));
      await send({ ...actual, collectionStatus: { root: collection, phase: "loading", discovery: { videos: 114, byFolder: { "": 114 }, complete: true } } });
      await expect(page.locator(".clip-card")).toHaveCount(6);
      await expect(page.locator(".clip-placeholder")).toHaveCount(108);
      await expect(page.getByText("114 videos found", { exact: true })).toBeVisible();
      await send({ ...actual, collectionStatus: { root: collection, phase: "refreshing" } });
      await expect(page.locator(".clip-card")).toHaveCount(6);
      await expect(page.getByLabel("Opening collection")).toHaveCount(0);
      await send({ ...actual, collectionStatus: { root: collection, phase: "error", error: "Fixture offline" } });
      await expect(page.locator(".clip-card")).toHaveCount(6);
      await expect(page.getByRole("button", { name: /Collection refresh failed/ })).toBeVisible();
      await send(actual);
      await page.waitForTimeout(250);
      const originalFirst = actual.clips[0]!,
         following = actual.clips[1]!;
      await send({ ...actual, clips: actual.clips.slice(1) });
      await expect(page.getByRole("button", { name: `Open ${originalFirst.name}`, exact: true })).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search clips", exact: true }).fill("Third");
      await expect(page.locator(".clip-card")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Open Third", exact: true })).toBeVisible();
      await page.getByRole("textbox", { name: "Search clips", exact: true }).fill("");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await send({ ...actual, clips: [following] });
      await expect(page.locator(".clip-card")).toHaveCount(1);
      await send({ ...actual, clips: [], collectionStatus: { root: collection, phase: "ready" } });
      await expect(page.getByText("No clips", { exact: true })).toBeVisible();
      await send({ ...actual, clips: [], folders: [], categories: [], collectionStatus: { root: join(profile, "Other"), phase: "loading" } });
      await expect(page.getByLabel("Opening collection")).toBeVisible();
      await expect(page.getByRole("button", { name: `Open ${following.name}`, exact: true })).toHaveCount(0);
      await app.evaluate(({ ipcMain }, snapshot) => {
         ipcMain.removeHandler("state");
         ipcMain.handle("state", () => ({ ...snapshot, preferences: { ...snapshot.preferences, setupComplete: false } }));
         ipcMain.removeHandler("sources");
         ipcMain.handle(
            "sources",
            () =>
               new Promise((resolve) => {
                  (globalThis as typeof globalThis & { resolveSources?: (value: unknown[]) => void }).resolveSources = resolve;
               })
         );
      }, actual);
      await page.reload();
      await expect(page.getByRole("status").filter({ hasText: /^Finding capture sources$/ })).toBeVisible();
      await expect(page.getByText("No screens found. Check capture permissions.", { exact: true })).toHaveCount(0);
      await page.waitForTimeout(400);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680));
      await app.evaluate(() => (globalThis as typeof globalThis & { resolveSources?: (value: unknown[]) => void }).resolveSources?.([]));
      await expect(page.getByText("No screens found. Check capture permissions.", { exact: true })).toBeVisible();
      await app.evaluate(({ ipcMain }) => {
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", () => {
            throw new Error("Fixture source error");
         });
      });
      await page.reload();
      await expect(page.getByRole("button", { name: "Retry sources", exact: true })).toBeVisible();
      await expect(page.getByText("No screens found. Check capture permissions.", { exact: true })).toHaveCount(0);
      await app.evaluate(({ ipcMain }, sources) => {
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", () => sources);
      }, available);
      await page.getByRole("button", { name: "Retry sources", exact: true }).click();
      await expect(page.locator(".setup-source-tile").first()).toBeVisible();
   } finally {
      await app.close();
   }
});
