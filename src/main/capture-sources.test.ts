import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameCandidate } from "../shared/types";
import { CaptureSources } from "./capture-sources";

const electron = vi.hoisted(() => {
   const icon = { isEmpty: () => false, resize: () => ({ toDataURL: () => "data:image/png;base64,icon" }) };
   const display = {
      id: 7,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      size: { width: 1920, height: 1080 },
      scaleFactor: 1,
      nativeOrigin: { x: 0, y: 0 },
   };
   return {
      icon,
      display,
      getAllDisplays: vi.fn(() => [display]),
      getFileIcon: vi.fn(async () => icon),
      getSources: vi.fn(async () => [
         { id: "screen:0:0", name: "Screen 1", display_id: "7", thumbnail: { toDataURL: () => "" } },
         { id: "window:42:0", name: "Application", display_id: "", thumbnail: { toDataURL: () => "" } },
      ]),
   };
});
vi.mock("electron", () => ({
   app: { getFileIcon: electron.getFileIcon },
   desktopCapturer: { getSources: electron.getSources },
   nativeImage: { createEmpty: () => ({ toDataURL: () => "" }) },
   screen: {
      getAllDisplays: electron.getAllDisplays,
      dipToScreenRect: (_window: unknown, bounds: unknown) => bounds,
   },
}));

const application: GameCandidate = { id: "window:42:0", name: "Application", pid: 88, executable: "C:\\Game.exe", foreground: true, fullscreen: false };
function recorder() {
   return {
      capturableApplications: vi.fn(async (): Promise<GameCandidate[]> => [application]),
      applicationCandidates: vi.fn(async (): Promise<GameCandidate[]> => []),
      capabilities: vi.fn(async () => ({ supported: true, hardwareEncoders: [], recommended: "standard" as const, message: "" })),
   };
}
beforeEach(() => {
   electron.getAllDisplays.mockReset().mockReturnValue([electron.display]);
   electron.getSources.mockClear();
   electron.getFileIcon.mockReset().mockResolvedValue(electron.icon);
});
afterEach(() => vi.restoreAllMocks());

describe.skipIf(process.platform !== "win32")("Windows source discovery", () => {
   it("retains an unknown executable's identity while its native process is unchanged", async () => {
      const native = recorder();
      native.capturableApplications.mockResolvedValue([{ ...application, executable: "" }]);
      const sources = new CaptureSources(native, () => "999");
      const first = await sources.list();
      const now = Date.now();
      const time = vi.spyOn(Date, "now").mockReturnValue(now + 1000);
      expect((await sources.list())[1]?.applicationId).toBe(first[1]?.applicationId);
      native.capturableApplications.mockResolvedValue([{ ...application, executable: "", pid: 99 }]);
      time.mockReturnValue(now + 2000);
      expect((await sources.list())[1]?.applicationId).not.toBe(first[1]?.applicationId);
   });
   it("starts native and Electron enumeration together without capturing thumbnails", async () => {
      const native = recorder();
      let finish: ((candidates: GameCandidate[]) => void) | undefined;
      native.capturableApplications.mockImplementation(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      const sources = new CaptureSources(native, () => "999");
      const loading = sources.list();
      expect(electron.getSources).toHaveBeenCalledWith({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
      finish!([application]);
      expect((await loading).map((source) => source.id)).toEqual(["screen:0:0", "window:42:0"]);
   });

   it("returns usable sources while executable icons are still loading", async () => {
      let finish: ((icon: typeof electron.icon) => void) | undefined;
      electron.getFileIcon.mockImplementation(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      const changed = vi.fn();
      const sources = new CaptureSources(recorder(), () => "999", changed);
      const first = await sources.list();
      expect(first[1]).toMatchObject({ id: application.id, processId: 88 });
      expect(first[1]?.appIcon).toBeUndefined();
      expect(changed).not.toHaveBeenCalled();
      finish!(electron.icon);
      await expect.poll(() => sources.cached[1]?.appIcon).toBe("data:image/png;base64,icon");
      expect(changed).toHaveBeenCalledTimes(1);
   });

   it("hydrates an Electron-owned window without replacing Electron's capture identity", async () => {
      electron.getSources.mockResolvedValueOnce([{ id: "window:42:1", name: "Application", display_id: "", thumbnail: { toDataURL: () => "" } }]);
      const sources = new CaptureSources(recorder(), () => "999");
      const list = await sources.list();
      expect(list[0]).toMatchObject({ id: "window:42:1", processId: 88 });
      await expect.poll(() => sources.cached[0]?.appIcon).toBe("data:image/png;base64,icon");
      expect(sources.cached[0]?.id).toBe("window:42:1");
   });

   it("uses the stable executable icon instead of the window icon", async () => {
      const windowIcon = { isEmpty: () => false, resize: () => ({ toDataURL: () => "data:image/png;base64,window" }) };
      const windows = [{ id: "window:42:1", name: "Application", display_id: "", thumbnail: { toDataURL: () => "" }, appIcon: windowIcon }];
      electron.getSources.mockResolvedValueOnce(windows);
      const sources = new CaptureSources(recorder(), () => "999");
      await sources.list();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sources.cached[0]?.appIcon).toBe("data:image/png;base64,icon");
   });

   it("fetches thumbnails only for an explicit image request, including immediately after a metadata query", async () => {
      const sources = new CaptureSources(recorder(), () => "999");
      await sources.list();
      await sources.list(true);
      expect(electron.getSources).toHaveBeenLastCalledWith({
         types: ["screen", "window"],
         thumbnailSize: { width: 320, height: 180 },
         fetchWindowIcons: false,
      });
   });

   it("rejects preview when a window handle now belongs to a different process", async () => {
      const native = recorder();
      const sources = new CaptureSources(native, () => "999");
      await sources.list();
      native.capturableApplications.mockResolvedValue([{ ...application, pid: 99 }]);
      expect(await sources.preview(application.id)).toEqual([]);
   });
   it("keeps metadata available while an optional thumbnail request is pending", async () => {
      const sources = new CaptureSources(recorder(), () => "999");
      const first = await sources.list();
      let finish: ((frames: Awaited<ReturnType<typeof electron.getSources>>) => void) | undefined;
      electron.getSources.mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      const thumbnails = sources.list(true);
      await expect.poll(() => electron.getSources.mock.calls.length).toBe(2);
      expect((await sources.list()).map((source) => source.id)).toEqual(first.map((source) => source.id));
      finish!([]);
      await thumbnails;
   });
});

describe.skipIf(process.platform !== "linux")("Wayland portal ownership", () => {
   it("does not open an Electron picker when only the session type advertises Wayland", async () => {
      vi.stubEnv("WAYLAND_DISPLAY", "");
      vi.stubEnv("XDG_SESSION_TYPE", "wayland");
      try {
         const sources = new CaptureSources(recorder(), () => "999");
         expect(await sources.list(true)).toEqual([]);
         expect(electron.getSources).not.toHaveBeenCalled();
      } finally {
         vi.unstubAllEnvs();
      }
   });
});

describe("capture window exclusion", () => {
   it("excludes the application's own window by its media source identity", async () => {
      const native = recorder();
      native.capturableApplications.mockResolvedValue([application]);
      const sources = new CaptureSources(native, () => "42");
      expect((await sources.list()).some((source) => source.id === "window:42:0")).toBe(false);
   });
});

describe.skipIf(process.platform !== "linux")("Linux source discovery", () => {
   it("offers only application windows the native recorder can identify", async () => {
      const native = recorder();
      native.capturableApplications.mockResolvedValue([application]);
      expect((await new CaptureSources(native, () => "999").list()).map((source) => source.id)).toEqual(["screen:0:0", "window:42:0"]);
      native.capturableApplications.mockResolvedValue([]);
      expect((await new CaptureSources(native, () => "999").list()).map((source) => source.id)).toEqual(["screen:0:0"]);
   });
});

describe.skipIf(process.platform !== "linux")("Linux scaled display coordinates", () => {
   it("uses native pixel origins instead of multiplying mixed-scale logical positions", async () => {
      electron.getAllDisplays.mockReturnValue([
         {
            ...electron.display,
            bounds: { x: 1280, y: 0, width: 1093, height: 614 },
            size: { width: 1093, height: 614 },
            nativeOrigin: { x: 1920, y: 0 },
            scaleFactor: 1.25,
         },
      ]);
      const screen = (await new CaptureSources(recorder(), () => "999").list())[0]!;
      expect(screen.bounds).toEqual({ x: 1920, y: 0, width: 1366, height: 768 });
      expect(screen.pixelSize).toEqual({ width: 1366, height: 768 });
   });
});
