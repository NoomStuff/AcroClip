import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { resolve, join } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

/** Entry names and text, read through the central directory. */
function unzip(archive: Buffer): Map<string, string> {
   const end = archive.length - 22;
   let cursor = archive.readUInt32LE(end + 16);
   const files = new Map<string, string>();
   for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
      const method = archive.readUInt16LE(cursor + 10);
      const size = archive.readUInt32LE(cursor + 20);
      const nameLength = archive.readUInt16LE(cursor + 28);
      const offset = archive.readUInt32LE(cursor + 42);
      const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      const start = offset + 30 + archive.readUInt16LE(offset + 26);
      const body = archive.subarray(start, start + size);
      files.set(name, (method === 8 ? inflateRawSync(body) : body).toString("utf8"));
      cursor += 46 + nameLength;
   }
   return files;
}

test("troubleshooting exports logs and opens a prefilled bug report", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-troubleshooting-")),
      collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F3",
      })
   );
   const exported = join(profile, "chosen.zip");
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog, shell }, path) => {
         const fixture = globalThis as typeof globalThis & { opened?: string; shown?: string[] };
         fixture.shown = [];
         dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
         shell.showItemInFolder = (item) => void fixture.shown!.push(item);
         shell.openExternal = async (url) => {
            fixture.opened = url;
         };
      }, exported);
      expect((await readFile(join(profile, "logs", "session.json"), "utf8")).includes('"clean":false')).toBe(true);

      // A window error reaches the app log with its stack, once the renderer is listening.
      await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
      await page.evaluate(() =>
         setTimeout(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("troubleshooting probe"), message: "probe" })))
      );
      await expect
         .poll(async () => (await readFile(join(profile, "logs", "app.log"), "utf8").catch(() => "")).includes("renderer error: troubleshooting probe"))
         .toBe(true);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      await page.getByRole("button", { name: "Export logs", exact: true }).click();
      await expect.poll(() => existsSync(exported)).toBe(true);
      const files = unzip(await readFile(exported));
      // A first run has no earlier sessions or rotated logs yet.
      expect([...files.keys()]).toEqual(expect.arrayContaining(["README.txt", "logs/app.log", "system.json"]));
      expect(files.get("logs/app.log")).toContain("troubleshooting probe");
      const system = JSON.parse(files.get("system.json")!) as { app: { version: string }; collection: { clips: number }; preferences: { clipSeconds: number } };
      expect(system.collection.clips).toBe(0);
      expect(system.preferences.clipSeconds).toBe(defaultPreferences.clipSeconds);

      await page.getByRole("button", { name: "Report a bug", exact: true }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { opened?: string }).opened)).toBeTruthy();
      const opened = new URL(await app.evaluate(() => (globalThis as typeof globalThis & { opened: string }).opened));
      expect(opened.pathname).toBe("/NoomStuff/AcroClip/issues/new");
      expect(opened.searchParams.get("template")).toBe("bug-report.yml");
      expect(opened.searchParams.get("version")).toBe(system.app.version);
      const shown = await app.evaluate(() => (globalThis as typeof globalThis & { shown: string[] }).shown);
      expect(shown).toHaveLength(2);
      expect(shown[1]!.startsWith(join(profile, "exports"))).toBe(true);
      expect(existsSync(shown[1]!)).toBe(true);
      expect(opened.searchParams.get("logs")).toContain(shown[1]!.split(/[\\/]/).at(-1)!);

      const summary = await page.evaluate(() => window.acroClip.statsSummary());
      expect(summary.app.launches).toBe(1);
      expect(summary.app.uncleanExits).toBe(0);
   } finally {
      await app.close();
   }
   expect(JSON.parse(await readFile(join(profile, "logs", "session.json"), "utf8"))).toMatchObject({ clean: true });
});
