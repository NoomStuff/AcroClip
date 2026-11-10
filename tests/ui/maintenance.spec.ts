import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

type Fixture = typeof globalThis & { confirmations?: string[]; answer?: number };

test("maintenance clears what each action names and leaves the clips alone", async () => {
   const profile = await mkdtemp(join(tmpdir(), "acroclip-maintenance-")),
      collection = join(profile, "clips");
   const metadata = join(collection, ".acroclip");
   await mkdir(join(metadata, "playback"), { recursive: true });
   await writeFile(join(metadata, "playback", "old-copy.mp4"), "converted copy");
   await writeFile(join(collection, "Keep me.mp4"), "not a real video, but the user's file");
   const preferencesFile = join(profile, "preferences.json");
   await writeFile(
      preferencesFile,
      JSON.stringify({
         ...defaultPreferences,
         collection,
         setupComplete: true,
         clipSeconds: 45,
         audioSources: [],
         audioSourcesVersion: undefined,
         shortcuts: { toggleRecording: "" },
         shortcut: "Control+Alt+Shift+F3",
         // Retired in 0.21.0. An old file that still has it must load.
         stats: false,
      })
   );
   await writeFile(`${preferencesFile}.bak`, "{}");
   const appLog = join(profile, "logs", "app.log");
   const app = await electron.launch({ args: [resolve("."), "--disable-gpu-sandbox"], env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile } });
   const exited = new Promise((done) => app.process().once("exit", done));
   try {
      const page = await app.firstWindow();
      await app.evaluate(({ dialog }) => {
         const fixture = globalThis as Fixture;
         fixture.confirmations = [];
         fixture.answer = 0;
         dialog.showMessageBox = (async (...args: unknown[]) => {
            const options = args.at(-1) as { detail?: string };
            fixture.confirmations!.push(options.detail ?? "");
            return { response: fixture.answer ?? 0, checkboxChecked: false };
         }) as typeof dialog.showMessageBox;
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "App & updates", exact: true }).click();
      await expect(page.getByRole("heading", { name: "History" })).toHaveCount(0);
      // The history is on without a switch, so the launch is already counted.
      expect((await page.evaluate(() => window.acroClip.statsSummary())).app.launches).toBe(1);
      await expect.poll(async () => (await readFile(appLog, "utf8").catch(() => "")).includes("session: AcroClip")).toBe(true);
      const dialog = page.getByRole("dialog");

      // Clearing history defaults to the logs only.
      await page.getByRole("button", { name: "Clear history", exact: true }).click();
      await expect(dialog.getByRole("checkbox", { name: /^Logs/ })).toBeChecked();
      await expect(dialog.getByRole("checkbox", { name: /^Usage stats/ })).not.toBeChecked();
      await dialog.getByRole("button", { name: "Clear", exact: true }).click();
      await expect.poll(async () => await readFile(appLog, "utf8").catch(() => "")).toContain("maintenance: cleared logs");
      expect(await readFile(appLog, "utf8")).not.toContain("session: AcroClip");
      expect((await page.evaluate(() => window.acroClip.statsSummary())).app.launches).toBe(1);

      // Nothing ticked means nothing to confirm.
      await page.getByRole("button", { name: "Clear history", exact: true }).click();
      await dialog.getByRole("checkbox", { name: /^Logs/ }).uncheck();
      await expect(dialog.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByRole("button", { name: "Clear cache", exact: true }).click();
      await dialog.getByRole("button", { name: "Clear cache", exact: true }).click();
      await expect.poll(() => existsSync(join(metadata, "playback"))).toBe(false);

      // The checklist feeds the native confirmation, and backing out there changes nothing.
      await page.getByRole("button", { name: "Factory reset", exact: true }).click();
      await expect(dialog.getByRole("checkbox")).toHaveCount(5);
      await dialog.getByRole("checkbox", { name: /^Layout/ }).uncheck();
      await dialog.getByRole("button", { name: "Factory reset", exact: true }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as Fixture).confirmations!.length)).toBe(1);
      expect((await app.evaluate(() => (globalThis as Fixture).confirmations!))[0]).toContain(
         "removes settings and recording setup, cache, logs and usage stats. AcroClip restarts and opens setup."
      );
      expect(JSON.parse(await readFile(preferencesFile, "utf8"))).toMatchObject({ clipSeconds: 45 });

      // Resetting settings keeps the collection and opens setup.
      await page.getByRole("button", { name: "Reset settings", exact: true }).click();
      await dialog.getByRole("button", { name: "Reset settings", exact: true }).click();
      await expect(page.locator("#setup-heading")).toBeVisible();
      const reset = JSON.parse(await readFile(preferencesFile, "utf8")) as Record<string, unknown>;
      expect(reset).toMatchObject({ clipSeconds: defaultPreferences.clipSeconds, collection, setupComplete: false });
      expect(reset).not.toHaveProperty("stats");

      // Confirmed, the reset removes every part asked for and the app exits. Tests skip the relaunch.
      await app.evaluate(() => void ((globalThis as Fixture).answer = 1));
      await page.evaluate(() => void window.acroClip.factoryReset(["settings", "cache", "logs", "stats"]).catch(() => undefined));
      await exited;
   } finally {
      await app.close().catch(() => undefined);
   }
   expect(existsSync(preferencesFile)).toBe(false);
   expect(existsSync(`${preferencesFile}.bak`)).toBe(false);
   expect(existsSync(join(metadata, "stats"))).toBe(false);
   expect(existsSync(join(metadata, "thumbnails"))).toBe(false);
   expect(existsSync(join(profile, "logs", "sessions.jsonl"))).toBe(false);
   expect(await readFile(appLog, "utf8").catch(() => "")).not.toContain("maintenance: cleared logs");
   expect(JSON.parse(await readFile(join(profile, "logs", "session.json"), "utf8"))).toMatchObject({ clean: true });
   expect(await readFile(join(collection, "Keep me.mp4"), "utf8")).toBe("not a real video, but the user's file");
});
