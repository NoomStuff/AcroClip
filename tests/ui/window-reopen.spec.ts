import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("a second launch replaces a destroyed main window", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-window-reopen-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(join(profile, "preferences.json"), JSON.stringify({ ...defaultPreferences, collection, setupComplete: true, autoRecord: false }));
   const application = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const original = await application.firstWindow();
      await expect(original.getByRole("button", { name: "Library", exact: true })).toBeVisible();
      if (process.platform === "linux") {
         expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMenuBarVisible())).toBe(false);
      }
      await application.evaluate(({ BrowserWindow }) => {
         const contents = BrowserWindow.getAllWindows()[0]!.webContents;
         contents.sendInputEvent({ type: "keyDown", keyCode: "F12" });
         contents.sendInputEvent({ type: "keyUp", keyCode: "F12" });
      });
      await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.isDevToolsOpened())).toBe(true);
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.closeDevTools());
      const reopened = application.waitForEvent("window");
      await application.evaluate(({ app, BrowserWindow }) => {
         BrowserWindow.getAllWindows()[0]!.destroy();
         app.emit("second-instance", null, [], "", {});
      });
      const replacement = await reopened;
      await expect(replacement.getByRole("button", { name: "Library", exact: true })).toBeVisible();
      expect(original.isClosed()).toBe(true);
   } finally {
      await application.close();
   }
});
