import "./interactive-test-guard";
import { _electron as electron, expect } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { extractAll, createPackageWithOptions } from "@electron/asar";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { defaultPreferences } from "../src/shared/defaults";

// Exercises the update path users take: an installed build downloads a newer
// installer from a feed, the user clicks "Restart to update", and the app must
// close quickly, install with no installer window and relaunch on its own.
// Isolated identities (app ID, executable, uninstall key, updater cache) keep it
// away from any real installation. It runs only on a disposable CI desktop.
if (process.platform !== "win32") throw new Error("The in-app update restart check covers the Windows installer.");
const unpacked = resolve(process.env["ACROCLIP_UPDATE_PAYLOAD"] ?? "release/win-unpacked");
if (!existsSync(join(unpacked, "AcroClip.exe"))) throw new Error(`Package the app first: ${unpacked} has no AcroClip.exe`);
const root = await mkdtemp(join(tmpdir(), "acroclip-update-restart-"));
// CI uploads this folder: timings, installer window log and the app log per scope.
const evidence = resolve(".cache/update-restart");
await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });
const maximumCloseMs = 20_000;
const localAppData = process.env["LOCALAPPDATA"]!;

const powershell = (script: string): string =>
   execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim();
const sha512 = async (file: string) =>
   createHash("sha512")
      .update(await readFile(file))
      .digest("base64");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T | null | undefined> | T | null | undefined, timeout: number, what: string): Promise<T> {
   const deadline = Date.now() + timeout;
   for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await wait(250);
   }
}

async function stagePayload(destination: string, product: string, version: string, cacheName: string, marker: string | null) {
   await cp(unpacked, destination, { recursive: true });
   await rename(join(destination, "AcroClip.exe"), join(destination, `${product}.exe`));
   // app.getVersion() reads the packaged package.json, so each fixture carries its own version.
   const resources = join(destination, "resources");
   const asar = join(resources, "app.asar");
   const extracted = join(root, `asar-${version}-${randomUUID()}`);
   extractAll(asar, extracted);
   const manifestPath = join(extracted, "package.json");
   const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
   manifest.version = version;
   await writeFile(manifestPath, JSON.stringify(manifest, null, 3));
   const unpackedFiles: string[] = [];
   const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
         const full = join(folder, entry.name);
         if (entry.isDirectory()) await walk(full);
         else unpackedFiles.push(relative(join(resources, "app.asar.unpacked"), full).replaceAll("\\", "/"));
      }
   };
   if (existsSync(join(resources, "app.asar.unpacked"))) {
      await walk(join(resources, "app.asar.unpacked"));
      await rm(join(resources, "app.asar.unpacked"), { recursive: true });
   }
   await rm(asar);
   await createPackageWithOptions(extracted, asar, unpackedFiles.length ? { unpack: `{${unpackedFiles.map((file) => `**/${file}`).join(",")}}` } : {});
   await rm(extracted, { recursive: true });
   // The runtime feed is replaced by the test server; the cache directory must be private.
   await writeFile(join(resources, "app-update.yml"), `provider: generic\nurl: http://127.0.0.1/unused\nupdaterCacheDirName: ${cacheName}\n`);
   if (marker) await writeFile(join(resources, "update-marker.txt"), marker);
}

function buildInstaller(project: string, payload: string, config: string, version: string, packageName: string, output: string): Promise<string> {
   return (async () => {
      await mkdir(project, { recursive: true });
      await writeFile(
         join(project, "package.json"),
         JSON.stringify({
            name: packageName,
            version,
            main: "index.js",
            description: "Isolated update verification",
            author: "AcroClip",
            license: "GPL-3.0-or-later",
         })
      );
      const result = spawnSync(
         "bunx",
         [
            "--no-install",
            "electron-builder",
            "--projectDir",
            project,
            "--prepackaged",
            payload,
            "--config",
            config,
            "--win",
            "nsis",
            "--x64",
            "--publish",
            "never",
         ],
         {
            stdio: "inherit",
            windowsHide: true,
            shell: true,
         }
      );
      if (result.status !== 0) throw new Error(`Fixture packaging failed: ${result.status}`);
      const files = (await readdir(output)).filter((name) => name.endsWith(".exe") && name.includes(version));
      if (files.length !== 1) throw new Error(`Expected one ${version} installer, found ${files.join(", ")}`);
      return join(output, files[0]!);
   })();
}

function runInstaller(file: string, args: string[]): void {
   const result = spawnSync(file, args, { windowsHide: true, timeout: 180_000 });
   if (result.error) throw result.error;
   if (result.status !== 0) throw new Error(`Installer ${file} ${args.join(" ")} failed: ${result.status}`);
}

function installedVersion(product: string): string | null {
   const value = powershell(
      `$e = @(Get-ChildItem 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall','HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object DisplayName -like '${product}*'); if ($e.Count -eq 1) { $e[0].DisplayVersion }`
   );
   return value || null;
}

function processesUnder(folder: string): Array<{ ProcessId: number; ExecutablePath: string; CreationDate: string }> {
   const json = powershell(
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${folder.replaceAll("'", "''")}', 'OrdinalIgnoreCase') } | Select-Object ProcessId,ExecutablePath,@{n='CreationDate';e={$_.CreationDate.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress`
   );
   if (!json) return [];
   const parsed = JSON.parse(json) as unknown;
   return (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId: number; ExecutablePath: string; CreationDate: string }>;
}

// Records every visible top-level window owned by a process that is not the app
// itself: the installer, its elevated copy, or a fallback that opened the wizard.
const watcherScript = join(root, "watch-windows.ps1");
await writeFile(
   watcherScript,
   `param([string]$Output, [string]$Stop, [string]$AppExe)
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class TopWindows {
  delegate bool Callback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  public static List<string> Read() {
    var found = new List<string>();
    EnumWindows((window, unused) => {
      if (!IsWindowVisible(window)) return true;
      uint owner; GetWindowThreadProcessId(window, out owner);
      var text = new StringBuilder(512); GetWindowText(window, text, 512);
      found.Add(owner + "\\t" + text.ToString());
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$seen = @{}
while (-not (Test-Path -LiteralPath $Stop)) {
  foreach ($entry in [TopWindows]::Read()) {
    $parts = $entry.Split([char]9, 2)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($parts[0])" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.ExecutablePath) { continue }
    $path = $process.ExecutablePath
    $installerLike = $path -like '*-updater*' -or $path -like '*Setup*' -or $path -like '*Installer*' -or $path -like '*\\elevate.exe' -or $path -like '*\\Un_*' -or $process.Name -like 'Un_*'
    if (-not $installerLike -or $path -eq $AppExe) { continue }
    $key = "$($parts[0])|$($parts[1])"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); pid = [int]$parts[0]; path = $path; title = $parts[1] } | ConvertTo-Json -Compress | Out-File -LiteralPath $Output -Append -Encoding utf8
  }
  Start-Sleep -Milliseconds 100
}
`
);

interface Variant {
   scope: "user" | "machine";
}
const results: Array<Record<string, unknown>> = [];

async function verify({ scope }: Variant): Promise<void> {
   const id = randomUUID().replaceAll("-", "").slice(0, 10);
   const product = `AcroClipUpdateTest${scope === "user" ? "User" : "Machine"}${id}`;
   const packageName = `acroclip-update-${scope}-${id}`;
   const cacheName = `${packageName}-updater`;
   const cache = join(localAppData, cacheName);
   const base = join(root, scope);
   const output = join(base, "packages");
   const install = scope === "user" ? join(base, "install folder") : join(process.env["ProgramFiles"]!, product);
   const executable = join(install, `${product}.exe`);
   const marker = `update ${id}`;
   const config = join(base, "builder.json");
   await mkdir(output, { recursive: true });
   await writeFile(
      config,
      JSON.stringify({
         electronVersion: JSON.parse(await readFile("node_modules/electron/package.json", "utf8")).version,
         appId: `dev.acroclip.update-test.${scope}.${id}`,
         productName: product,
         executableName: product,
         win: { target: "nsis", signExecutable: false },
         nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            include: resolve("build/installer.nsh"),
            runAfterFinish: false,
            uninstallDisplayName: product,
         },
         compression: "store",
         directories: { output },
         publish: null,
      })
   );
   await stagePayload(join(base, "v1"), product, "0.0.1", cacheName, null);
   await stagePayload(join(base, "v2"), product, "0.0.2", cacheName, marker);
   const first = await buildInstaller(join(base, "project"), join(base, "v1"), config, "0.0.1", packageName, output);
   const second = await buildInstaller(join(base, "project"), join(base, "v2"), config, "0.0.2", packageName, output);
   const secondName = (await readdir(output)).find((name) => join(output, name) === second)!;
   const feed = [
      "version: 0.0.2",
      "files:",
      `  - url: ${secondName}`,
      `    sha512: ${await sha512(second)}`,
      `    size: ${(await stat(second)).size}`,
      `path: ${secondName}`,
      `sha512: ${await sha512(second)}`,
      `releaseDate: '${new Date().toISOString()}'`,
      "",
   ].join("\n");
   let application: ElectronApplication | undefined;
   let server: Server | undefined;
   const stopWatcher = join(base, "stop-watcher");
   const windowsLog = join(evidence, `${scope}-installer-windows.jsonl`);
   let watcher: ReturnType<typeof spawn> | undefined;
   try {
      runInstaller(first, ["/S", scope === "user" ? "/currentuser" : "/allusers", `/D=${install}`]);
      assert.equal(installedVersion(product), "0.0.1", "The first fixture must be installed");
      const size = (await stat(second)).size;
      server = createServer((request, response) => {
         const path = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
         if (path === "/releases/latest") {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
               JSON.stringify({ tag_name: "v0.0.2", name: "Update fixture", html_url: "https://example.invalid/release", draft: false, prerelease: false })
            );
         } else if (path === "/feed/latest.yml") {
            response.writeHead(200, { "content-type": "text/yaml" });
            response.end(feed);
         } else if (path === `/feed/${secondName}`) {
            response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(size) });
            createReadStream(second).pipe(response);
         } else {
            response.writeHead(404);
            response.end();
         }
      });
      const listening = server;
      await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
      const address = listening.address();
      if (!address || typeof address === "string") throw new Error("The update server did not start");
      const profile = join(base, "profile");
      const collection = join(profile, "clips");
      await mkdir(collection, { recursive: true });
      await writeFile(
         join(profile, "preferences.json"),
         JSON.stringify({
            ...defaultPreferences,
            collection,
            setupComplete: true,
            updateCheck: true,
            clipSeconds: 10,
            quality: "low",
            shortcut: "Control+Alt+Shift+F11",
            notifications: "off",
            sound: false,
            allowSoftwareEncoder: process.env["ACROCLIP_PACKAGED_TEST_SOFTWARE"] === "1",
         })
      );
      application = await electron.launch({
         executablePath: executable,
         args: ["--disable-gpu-sandbox"],
         env: {
            ...process.env,
            ACROCLIP_TEST: "1",
            ACROCLIP_PROFILE: profile,
            ACROCLIP_COLLECTION: collection,
            ACROCLIP_UPDATE_SERVER: `http://127.0.0.1:${address.port}`,
         },
      });
      const page = await application.firstWindow();
      await page.waitForFunction(() => !!window.acroClip);
      assert.equal(await page.evaluate(async () => (await window.acroClip.state()).version), "0.0.1");
      // Real capture is running when users update; that is what made restarts slow and prompt.
      const source = (await page.evaluate(() => window.acroClip.sources())).find((item) => item.kind === "screen");
      assert(source, "A screen source must be available");
      await page.evaluate(async (sourceId) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceId, sourceKind: "screen" });
         await window.acroClip.startRecording();
      }, source.id);
      await expect
         .poll(() => page.evaluate(async () => (await window.acroClip.state()).recorder.availableSeconds), { timeout: 60_000 })
         .toBeGreaterThanOrEqual(4);
      await page.evaluate(() => window.acroClip.checkUpdate());
      await expect.poll(() => page.evaluate(async () => (await window.acroClip.state()).update.state), { timeout: 120_000 }).toBe("ready");
      watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", watcherScript, windowsLog, stopWatcher, executable], {
         windowsHide: true,
         stdio: "ignore",
      });
      await wait(1500);
      const child = application.process();
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      // A clip save in flight at the click must still complete before the installer runs.
      await page.evaluate(() => void window.acroClip.saveClip());
      const chip = page.locator(".update-chip-wrap button");
      await expect(chip).toHaveAttribute("aria-label", "Restart to update");
      const clicked = Date.now();
      await chip.click({ noWaitAfter: true }).catch(() => undefined);
      await Promise.race([exited, wait(maximumCloseMs + 10_000)]);
      const closeMs = Date.now() - clicked;
      assert(child.exitCode !== null || child.signalCode !== null, `The app was still open ${closeMs} ms after "Restart to update"`);
      application = undefined;
      await until(() => installedVersion(product) === "0.0.2", 180_000, "the update to install");
      assert.equal(await readFile(join(install, "resources", "update-marker.txt"), "utf8"), marker, "The new payload must be installed in place");
      const relaunched = await until(
         () =>
            processesUnder(install).find((item) => item.ExecutablePath.toLowerCase() === executable.toLowerCase() && Date.parse(item.CreationDate) > clicked),
         90_000,
         "the updated app to relaunch"
      );
      const relaunchMs = Date.parse(relaunched.CreationDate) - clicked;
      await writeFile(stopWatcher, "");
      await wait(500);
      const windows = existsSync(windowsLog) ? (await readFile(windowsLog, "utf8")).trimStart().split(/\r?\n/).filter(Boolean) : [];
      assert.deepEqual(windows, [], `The update showed installer windows:\n${windows.join("\n")}`);
      const record = JSON.parse(await readFile(join(profile, "update-install.json"), "utf8")) as { fromVersion: string; targetVersion: string };
      assert.deepEqual([record.fromVersion, record.targetVersion], ["0.0.1", "0.0.2"]);
      const clips = (await readdir(collection, { recursive: true })).filter((name) => /\.(mkv|mp4)$/i.test(name));
      assert(clips.length >= 1, "The clip saved during the restart must be in the collection");
      const kept = JSON.parse(await readFile(join(profile, "preferences.json"), "utf8")) as { collection: string; shortcut: string };
      assert.deepEqual([kept.collection, kept.shortcut], [collection, "Control+Alt+Shift+F11"], "User settings must survive the update");
      const log = await readFile(join(profile, "logs", "app.log"), "utf8").catch(() => "");
      const lines = log.split("\n").filter((line) => line.includes("update"));
      await writeFile(join(evidence, `${scope}-app.log`), log);
      assert(closeMs <= maximumCloseMs, `Closing for the update took ${closeMs} ms`);
      results.push({ scope, closeMs, relaunchMs, clips: clips.length });
      console.log(`${scope}: closed ${closeMs} ms after the click, relaunched after ${relaunchMs} ms, no installer windows.`);
      for (const line of lines) console.log(`  ${line}`);
   } finally {
      if (watcher && watcher.exitCode === null) {
         await writeFile(stopWatcher, "").catch(() => undefined);
         watcher.kill();
      }
      if (application) await application.close().catch(() => undefined);
      server?.closeAllConnections();
      server?.close();
      // The relaunched copy runs outside the test profile; end it before uninstalling.
      for (const item of processesUnder(install)) spawnSync("taskkill", ["/PID", String(item.ProcessId), "/T", "/F"], { windowsHide: true });
      const uninstaller = join(install, `Uninstall ${product}.exe`);
      if (existsSync(uninstaller)) spawnSync(uninstaller, ["/S", ...(scope === "machine" ? ["/allusers"] : [])], { windowsHide: true, timeout: 120_000 });
      if (existsSync(cache) && relative(localAppData, cache).startsWith(packageName)) await rm(cache, { recursive: true, force: true });
   }
}

const failures: unknown[] = [];
for (const scope of ["user", "machine"] as const) {
   try {
      await verify({ scope });
   } catch (error) {
      console.error(`${scope} update restart failed:`, error);
      failures.push(error);
   }
}
await writeFile(join(evidence, "results.json"), JSON.stringify(results, null, 2));
console.log(`Update restart evidence: ${evidence}`);
if (failures.length) process.exit(1);
