// Copyright (c) 2026 NoomStuff. MIT. Adapted from AttaCut update manager tests.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { app, net } from "electron";
import type * as NodeFs from "node:fs";
import { UpdateManager, fetchAvailableUpdate } from "./update-manager";
import { Updates } from "./updates";

vi.mock("electron", () => ({ app: { isPackaged: true, getVersion: () => "0.14.1", getPath: vi.fn() }, net: { fetch: vi.fn() } }));
vi.mock("node:fs", async (original) => {
   const actual = await original<typeof NodeFs>();
   return { ...actual, existsSync: (path: string) => path.endsWith("app-update.yml") || actual.existsSync(path) };
});
const automatic = await vi.hoisted(async () => {
   const { EventEmitter } = await import("node:events");
   return Object.assign(new EventEmitter(), { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() });
});
vi.mock("electron-updater", () => ({ autoUpdater: automatic }));
const folders: string[] = [];
afterEach(async () => {
   vi.useRealTimers();
   vi.unstubAllEnvs();
   vi.resetAllMocks();
   automatic.removeAllListeners();
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
const release = { version: "0.15.0", name: "next", url: "https://example.com/release", mode: "releases" as const };
function manager() {
   const send = vi.fn();
   return { manager: new UpdateManager((status) => send("update:status", status)), send };
}
it.each([404, 429, 500])("reports HTTP %s during release checks", async (status) => {
   await expect(fetchAvailableUpdate("0.14.1", async () => new Response("", { status }))).rejects.toThrow(String(status));
});
it.each([{}, { tag_name: 123 }, { tag_name: "0.15.0", name: null, html_url: "bad", draft: false, prerelease: false }])(
   "rejects malformed releases %j",
   async (value) => {
      await expect(fetchAvailableUpdate("0.14.1", async () => Response.json(value))).rejects.toThrow();
   }
);
it.each(["draft", "prerelease"])("ignores %s releases", async (field) => {
   expect(
      await fetchAvailableUpdate("0.14.1", async () =>
         Response.json({ tag_name: "0.15.0", name: null, html_url: release.url, draft: false, prerelease: false, [field]: true })
      )
   ).toBeNull();
});
it.skipIf(process.platform === "darwin")("handles automatic progress, readiness, install and errors", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   automatic.checkForUpdates.mockResolvedValue({ downloadPromise: Promise.resolve([]) });
   const { manager: updates, send } = manager();
   expect(() => updates.install()).toThrow("not ready");
   await updates.offer(release);
   await vi.waitFor(() => expect(automatic.checkForUpdates).toHaveBeenCalled());
   expect(automatic.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: "https://raw.githubusercontent.com/NoomStuff/AcroClip/updates/",
   });
   automatic.emit("download-progress", { percent: 42.3 });
   expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "downloading", percent: 42 }));
   automatic.emit("error", new Error("network lost"));
   expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" }));
   automatic.emit("update-downloaded", { version: release.version });
   expect(updates.isReady).toBe(true);
   updates.install();
   expect(automatic.quitAndInstall).toHaveBeenCalledWith(true, true);
});

it.skipIf(process.platform === "darwin")("keeps one automatic download active and associates readiness with the downloaded version", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   let finish!: () => void;
   automatic.checkForUpdates.mockResolvedValueOnce({
      downloadPromise: new Promise<void>((resolve) => {
         finish = resolve;
      }),
   });
   const { manager: updates, send } = manager();
   await updates.offer(release);
   await vi.waitFor(() => expect(automatic.checkForUpdates).toHaveBeenCalledTimes(1));
   await updates.offer(release);
   const next = { ...release, version: "0.16.0" };
   await updates.offer(next);
   expect(automatic.checkForUpdates).toHaveBeenCalledTimes(1);
   automatic.emit("download-progress", { percent: 50 });
   expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ version: release.version, phase: "downloading" }));
   automatic.emit("update-downloaded", { version: release.version });
   expect(updates.isReady).toBe(false);
   expect(() => updates.install()).toThrow("not ready");
   automatic.checkForUpdates.mockResolvedValueOnce({ downloadPromise: Promise.resolve([]) });
   finish();
   await vi.waitFor(() => expect(automatic.checkForUpdates).toHaveBeenCalledTimes(2));
   automatic.emit("update-downloaded", { version: next.version });
   expect(updates.isReady).toBe(true);
   await updates.offer(next);
   expect(automatic.checkForUpdates).toHaveBeenCalledTimes(2);
   expect(automatic.listenerCount("download-progress")).toBe(1);
   expect(automatic.listenerCount("update-downloaded")).toBe(1);
});

it.skipIf(process.platform !== "win32").each(["headers", "release body", "download body"])("cancels stalled portable %s and allows a retry", async (stage) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "portable.exe");
   const folder = await mkdtemp(join(tmpdir(), "attacut-update-"));
   folders.push(folder);
   vi.mocked(app.getPath).mockReturnValue(folder);
   const name = `AcroClip-${release.version}-win-${process.arch}.exe`;
   const response =
      stage === "release body"
         ? new Response(new ReadableStream())
         : Response.json({
              assets: [{ name, browser_download_url: "https://example.com/app", digest: "sha256:" + "a".repeat(64) }],
           });
   if (stage === "headers") vi.mocked(net.fetch).mockImplementationOnce(() => new Promise(() => {}));
   else vi.mocked(net.fetch).mockResolvedValueOnce(response);
   vi.mocked(net.fetch).mockResolvedValueOnce(new Response(new ReadableStream()));
   const { manager: updates } = manager();
   await updates.offer(release);
   vi.useFakeTimers();
   const pending = updates.downloadPortable(release.version);
   const rejected = expect(pending).rejects.toThrow("stalled");
   // File creation uses real I/O before the body watchdog starts.
   if (stage === "download body") await vi.waitFor(() => expect(net.fetch).toHaveBeenCalledTimes(2));
   await vi.advanceTimersByTimeAsync(31_000);
   await rejected;
   expect(vi.mocked(net.fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
   expect((await readdir(folder)).some((file) => file.endsWith(".part"))).toBe(false);
   vi.mocked(net.fetch).mockReset().mockRejectedValue(new Error("Retry reached network"));
   await expect(updates.downloadPortable(release.version)).rejects.toThrow("Retry reached network");
});
it.skipIf(process.platform !== "win32").each(["checksum", "interrupted", "http", "malformed", "success"])("portable download: %s", async (scenario) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "portable.exe");
   const folder = await mkdtemp(join(tmpdir(), "attacut-update-"));
   folders.push(folder);
   vi.mocked(app.getPath).mockReturnValue(folder);
   const bytes = Buffer.from("verified executable");
   const name = `AcroClip-0.15.0-win-${process.arch}.exe`;
   await writeFile(join(folder, name), "existing download");
   vi.mocked(net.fetch).mockResolvedValueOnce(
      scenario === "http"
         ? new Response("", { status: 500 })
         : Response.json(
              scenario === "malformed"
                 ? {}
                 : { assets: [{ name, browser_download_url: "https://example.com/app", digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") }] }
           )
   );
   const body =
      scenario === "interrupted"
         ? new ReadableStream({
              start(controller) {
                 controller.enqueue(bytes);
              },
              pull(controller) {
                 controller.error(new Error("lost connection"));
              },
           })
         : scenario === "checksum"
           ? Buffer.from("corrupt")
           : bytes;
   vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body));
   const { manager: updates, send } = manager();
   await updates.offer(release);
   if (scenario === "success") {
      await updates.downloadPortable(release.version);
      expect(await readFile(updates.downloadedPath!)).toEqual(bytes);
      expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "downloaded", percent: 100 }));
   } else {
      await expect(updates.downloadPortable(release.version)).rejects.toThrow();
      expect(updates.downloadedPath).toBeNull();
      expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" }));
   }
   expect(await readFile(join(folder, name), "utf8")).toBe("existing download");
   expect((await readdir(folder)).some((file) => file.endsWith(".part"))).toBe(false);
});

it.skipIf(process.platform === "darwin").each(["missing", "rejected"])("automatic update check handles %s packages", async (scenario) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   if (scenario === "missing") automatic.checkForUpdates.mockResolvedValue(null);
   else automatic.checkForUpdates.mockRejectedValue(new Error("connection failed"));
   const { manager: updates, send } = manager();
   await updates.offer(release);
   await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" })));
   expect(updates.isReady).toBe(false);
   expect(() => updates.install()).toThrow("not ready");
});

it.skipIf(process.platform === "darwin")("reports an outdated automatic feed instead of leaving the offered release downloading forever", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   automatic.checkForUpdates.mockImplementationOnce(async () => ({
      downloadPromise: Promise.resolve().then(() => {
         automatic.emit("update-downloaded", { version: "0.14.2" });
         return [];
      }),
   }));
   const { manager: updates, send } = manager();
   await updates.offer(release);
   await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ version: release.version, phase: "error" })));
   expect(updates.isReady).toBe(false);
});

it.skipIf(process.platform === "darwin")("shares ready state and asks before restarting through the recording-safe boundary", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   vi.mocked(net.fetch).mockResolvedValueOnce(
      Response.json({
         tag_name: "v0.15.0",
         name: "Next",
         html_url: "https://github.com/NoomStuff/AcroClip/releases/tag/v0.15.0",
         draft: false,
         prerelease: false,
      })
   );
   let finish!: () => void;
   automatic.checkForUpdates.mockResolvedValueOnce({
      downloadPromise: new Promise<void>((resolve) => {
         finish = resolve;
      }),
   });
   const updates = new Updates(() => {});
   await updates.check();
   await vi.waitFor(() => expect(updates.state.state).toBe("downloading"));
   automatic.emit("update-downloaded", { version: "0.15.0" });
   finish();
   expect(updates.state.state).toBe("ready");
   await updates.install(async () => false);
   expect(automatic.quitAndInstall).not.toHaveBeenCalled();
   await updates.install(async () => true);
   expect(automatic.quitAndInstall).toHaveBeenCalledWith(true, true);
});

it.skipIf(process.platform !== "win32").each(["destination", "temporary"])("keeps another download's %s created in flight", async (scope) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "/portable.exe");
   const folder = await mkdtemp(join(tmpdir(), "acroclip-update-race-"));
   folders.push(folder);
   vi.mocked(app.getPath).mockReturnValue(folder);
   const name = `AcroClip-${release.version}-win-${process.arch}.exe`,
      bytes = Buffer.from("verified package"),
      digest = createHash("sha256").update(bytes).digest("hex");
   vi.mocked(net.fetch).mockResolvedValueOnce(
      Response.json({ assets: [{ name, browser_download_url: "https://example.com/app", digest: `sha256:${digest}` }] })
   );
   const other = join(folder, name + (scope === "temporary" ? ".part" : ""));
   vi.mocked(net.fetch).mockImplementationOnce(async () => {
      await writeFile(other, "Another download owns this");
      return new Response(bytes);
   });
   const { manager: updates } = manager();
   await updates.offer(release);
   await expect(updates.downloadPortable(release.version)).rejects.toThrow();
   expect(await readFile(other, "utf8")).toBe("Another download owns this");
   expect(updates.downloadedPath).toBeNull();
});

it("does not repeat the startup lookup after a manual check", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "/portable.exe");
   vi.mocked(net.fetch).mockImplementation(async () =>
      Response.json({ tag_name: "v0.15.0", name: "Next", html_url: release.url, draft: false, prerelease: false })
   );
   const updates = new Updates(() => {});
   await updates.check();
   await updates.check(false);
   expect(net.fetch).toHaveBeenCalledTimes(1);
   await updates.check();
   expect(net.fetch).toHaveBeenCalledTimes(2);
});

it("checks release metadata in branded development without a download or install path", async () => {
   const original = Object.getOwnPropertyDescriptor(process, "defaultApp");
   Object.defineProperty(process, "defaultApp", { configurable: true, value: true });
   try {
      vi.mocked(net.fetch).mockResolvedValueOnce(
         Response.json({ tag_name: "v99.0.0", name: "AcroClip 99.0.0", html_url: "https://example.com/releases/v99.0.0", draft: false, prerelease: false })
      );
      const updates = new Updates(() => {});
      await updates.check();
      expect(updates.state).toMatchObject({ state: "available", version: "99.0.0", mode: "releases", lastChecked: expect.any(Number) });
      expect(net.fetch).toHaveBeenCalledTimes(1);
      expect(automatic.checkForUpdates).not.toHaveBeenCalled();
      await updates.download();
      expect(updates.state).toMatchObject({ state: "error", message: "This download is not available." });
      await expect(updates.install(async () => true)).rejects.toThrow("not ready");
      expect(net.fetch).toHaveBeenCalledTimes(1);
      expect(automatic.quitAndInstall).not.toHaveBeenCalled();
      const checked = updates.state.lastChecked;
      vi.mocked(net.fetch).mockRejectedValueOnce(new Error("Offline"));
      await updates.check();
      expect(updates.state.message).toBe("Couldn't check for updates. Try again later.");
      expect(updates.state.lastChecked).toBe(checked);
   } finally {
      if (original) Object.defineProperty(process, "defaultApp", original);
      else Reflect.deleteProperty(process, "defaultApp");
   }
});
