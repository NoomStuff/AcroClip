import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";
import { selectOption } from "./select-option";
test("Auto game management searches the saved catalogue and persists application overrides", async () => {
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-game-settings-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         shortcuts: { ...defaultPreferences.shortcuts, toggleRecording: "" },
         collection,
         setupComplete: true,
         sourceKind: "auto",
         desktopFallback: false,
         audioSources: defaultPreferences.audioSources.map((source) => ({ ...source, enabled: false })),
         shortcut: "Control+Alt+Shift+F3",
      })
   );
   await writeFile(
      join(profile, "game-catalog.json"),
      JSON.stringify({
         updated: Date.now(),
         entries: [
            { id: "celeste", name: "Celeste", executables: [{ name: "celeste.exe", os: process.platform }] },
            { id: "stardew", name: "Stardew Valley", executables: [{ name: "stardew.exe", os: process.platform }] },
            { id: "fixture", name: "Official fixture game", executables: [{ name: "local-game.exe", os: process.platform }] },
         ],
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ ipcMain }) => {
         ipcMain.removeHandler("games");
         ipcMain.handle("games", () => [
            {
               id: "window:777:0",
               pid: 777,
               name: "Running application fixture",
               executable: "C:/Controlled/local-game.exe",
               foreground: false,
               fullscreen: false,
            },
         ]);
      });
      await expect(page.locator(".detected-game")).toContainText("No game detected");
      await expect(page.getByText("Follow the active game", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      const search = page.getByRole("textbox", { name: "Search games", exact: true });
      await expect(search).toBeFocused();
      await expect(page.locator(".game-list>li")).toHaveCount(3);
      await search.fill("celeste");
      await expect(page.locator(".game-list>li")).toHaveCount(1);
      await expect(page.locator(".game-list")).toContainText("Celeste");
      await search.fill("missing");
      await expect(page.getByText("No matching games.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Running application", exact: true })).toBeEnabled();
      await selectOption(page, "Running application", "window:777:0");
      await page.getByRole("textbox", { name: "Game name", exact: true }).fill("My local game");
      await page.getByRole("button", { name: "Add selected game", exact: true }).click();
      await expect
         .poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.customGames)
         .toEqual([{ name: "My local game", executable: "C:/Controlled/local-game.exe" }]);
      await search.fill("");
      await expect(page.locator(".game-list>li")).toHaveCount(3);
      await search.fill("My local game");
      await expect(page.locator(".game-list>li")).toHaveCount(1);
      await expect(page.locator(".game-added")).toHaveText("Added");
      await page.screenshot({ path: "test-results/games-settings.png" });
      await page.reload();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.locator(".settings-sidebar").getByRole("button", { name: "Games", exact: true }).click();
      await page.getByRole("textbox", { name: "Search games", exact: true }).fill("My local game");
      await expect(page.locator(".game-added")).toHaveText("Added");
      await page.getByRole("button", { name: "Remove game My local game", exact: true }).click();
      await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.customGames.length).toBe(0);
      await page.getByRole("textbox", { name: "Search games", exact: true }).fill("Official fixture game");
      await expect(page.locator(".game-list>li")).toHaveCount(1);
      const state = await page.evaluate(() => window.acroClip.state());
      expect(state.preferences.desktopFallback).toBe(false);
      expect(state.recorder.state).toBe("stopped");
      await page.locator(".rail").getByRole("button", { name: "Recording", exact: true }).click();
      await expect(page.locator(".detected-game")).toContainText("No game detected");
      await expect(page.getByRole("combobox", { name: "Screen fallback", exact: true })).toContainText("Off");
      const screen = (await page.evaluate(() => window.acroClip.sources())).find((source) => source.kind === "screen");
      if (screen) {
         await selectOption(page, "Screen fallback", screen.id);
         await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.desktopFallback).toBe(true);
         const selected = await page.evaluate(() => window.acroClip.state());
         expect(selected.preferences.sourceId).toBe(screen.id);
         expect(selected.recorder.state).toBe("stopped");
         await selectOption(page, "Screen fallback", "");
         await expect.poll(async () => (await page.evaluate(() => window.acroClip.state())).preferences.desktopFallback).toBe(false);
      }
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680));
      await page.screenshot({ path: "test-results/auto-no-game-small.png" });
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Search games", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Add game", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Add game", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Add game", exact: true })).toHaveCount(0);
   } finally {
      await desktop.close();
   }
});
