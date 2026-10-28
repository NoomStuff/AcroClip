import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import type { AppState } from "../../src/shared/types";

test("mismatched and stale sources stay unselected without preview or capture fallback", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-source-selection-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         sourceKind: "app",
         sourceId: "screen:selection-fixture",
         shortcuts: { toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F6",
      })
   );
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      // The fixture retains this state across reloads. Wait for the real window
      // to show so an early hidden snapshot cannot disable source discovery.
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).windowVisible)).toBe(true);
      const initial = await page.evaluate(() => window.acroClip.state());
      await app.evaluate(({ ipcMain, BrowserWindow }, initial) => {
         // Source-selection UI does not require the CI machine to have a recorder.
         let current = initial;
         const supported = (state: AppState) => ({ ...state, recorder: { ...state.recorder, supported: true } });
         const web = BrowserWindow.getAllWindows()[0]!.webContents;
         const send = web.send.bind(web);
         web.send = (channel, ...args) => {
            if (channel === "app-event" && (args[0] as { type?: string })?.type === "state") {
               current = (args[0] as { state: AppState }).state;
               send(channel, { type: "state", state: supported(current) });
            } else if (channel === "app-event" && (args[0] as { type?: string })?.type === "state-patch") {
               current = { ...current, ...(args[0] as { patch: Partial<AppState> }).patch };
               send(channel, { type: "state", state: supported(current) });
            } else send(channel, ...args);
         };
         ipcMain.removeHandler("state");
         ipcMain.handle("state", () => supported(current));
         ipcMain.removeHandler("recording-capabilities");
         ipcMain.handle("recording-capabilities", () => ({ supported: true, hardwareEncoders: [], recommended: "standard", message: "" }));
         ipcMain.removeHandler("monitor-audio");
         ipcMain.handle("monitor-audio", () => {});
         const fixture = globalThis as typeof globalThis & {
            previewIds?: string[];
            fixtureSources?: Array<{ id: string; kind: "screen" | "app"; name: string; thumbnail: string }>;
         };
         fixture.previewIds = [];
         fixture.fixtureSources = [{ id: "screen:selection-fixture", kind: "screen", name: "Fixture screen", thumbnail: "" }];
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", async () => {
            await new Promise((resolve) => setTimeout(resolve, 150));
            return fixture.fixtureSources;
         });
         ipcMain.removeHandler("preview-source");
         ipcMain.handle("preview-source", (_event, id: string | null) => {
            if (id) {
               fixture.previewIds!.push(id);
               throw new Error("Fixture preview boundary");
            }
         });
      }, initial);
      await page.reload();
      const start = page.getByRole("button", { name: "Start recording", exact: true });
      await expect(page.getByText("Choose what to capture", { exact: true })).toBeVisible();
      await expect(start).toBeDisabled();
      await expect(page.locator(".audio-listen").first()).toBeDisabled();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { previewIds: string[] }).previewIds)).toEqual([]);
      await expect(page.getByText("Open an application to capture.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Screen", exact: true }).click();
      await expect(start).toBeEnabled();
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).preferences.sourceId)).toBe("screen:selection-fixture");
      await page.getByRole("button", { name: "App", exact: true }).click();
      await expect(start).toBeDisabled();
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).preferences.sourceId)).toBe("");
      await app.evaluate(({ ipcMain }) => {
         ipcMain.removeHandler("sources");
         ipcMain.handle("sources", () => [
            { id: "screen:selection-fixture", kind: "screen", name: "Fixture screen", thumbnail: "" },
            { id: "window:12345:0", kind: "app", name: "Another application", thumbnail: "" },
         ]);
      });
      await page.evaluate(async () => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceId: "window:gone:0" });
      });
      await page.reload();
      await expect(page.getByRole("button", { name: "Another application", exact: true })).toBeVisible();
      await expect(start).toBeDisabled();
      await expect(page.getByText("Choose what to capture", { exact: true })).toBeVisible();
      expect(await app.evaluate(() => (globalThis as typeof globalThis & { previewIds: string[] }).previewIds)).toEqual(["screen:selection-fixture"]);
      const log = await readFile(join(profile, "logs", "app.log"), "utf8").catch(() => "");
      expect(log).not.toContain("Capture audio source unavailable");
   } finally {
      await app.close();
   }
});
