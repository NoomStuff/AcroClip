import { describe, expect, it, vi } from "vitest";
import { OpenWith, desktopEntryCandidates, linuxDataDirectories, parseDesktopEntry, parseGioMime } from "./open-with";
import type { OpenWithPlatform } from "./open-with";

const app = (id: string, isDefault = false) => ({ id, name: id.toUpperCase(), icon: "", isDefault });

describe("open with", () => {
   it("lists once per file type and opens only an app it listed", async () => {
      const platform: OpenWithPlatform = {
         list: vi.fn(async () => ({ apps: [app("vlc", true), app("mpv")], canChoose: true })),
         open: vi.fn(async () => undefined),
      };
      const openWith = new OpenWith(platform);
      expect((await openWith.list("C:\\Clips\\a.mp4")).apps.map((item) => item.id)).toEqual(["vlc", "mpv"]);
      await openWith.list("C:\\Clips\\b.MP4");
      expect(platform.list).toHaveBeenCalledTimes(1);
      await openWith.open("C:\\Clips\\a.mp4", "mpv");
      expect(platform.open).toHaveBeenCalledWith("C:\\Clips\\a.mp4", app("mpv"));
      // An id the renderer made up, such as a path to some other program, never reaches the system.
      await expect(openWith.open("C:\\Clips\\a.mp4", "C:\\Windows\\System32\\cmd.exe")).rejects.toThrow(/no longer available/);
      expect(platform.open).toHaveBeenCalledTimes(1);
   });
   it("falls back to an empty list, and asks again next time, when the system can't list apps", async () => {
      const platform: OpenWithPlatform = { list: vi.fn(async () => Promise.reject(new Error("gio is missing"))), open: vi.fn() };
      const openWith = new OpenWith(platform);
      expect(await openWith.list("/clips/a.mkv")).toEqual({ apps: [], canChoose: false });
      await openWith.list("/clips/a.mkv");
      expect(platform.list).toHaveBeenCalledTimes(2);
      expect(await new OpenWith(null).list("/clips/a.mkv")).toEqual({ apps: [], canChoose: false });
   });
   it("reads gio's default and recommended apps", () => {
      const output = [
         "Default application for “video/mp4”: org.videolan.VLC.desktop",
         "Registered applications:",
         "\tmpv.desktop",
         "\torg.videolan.VLC.desktop",
         "\torg.gnome.Totem.desktop",
         "Recommended applications:",
         "\torg.videolan.VLC.desktop",
         "\tmpv.desktop",
      ].join("\n");
      expect(parseGioMime(output)).toEqual({ defaultId: "org.videolan.VLC.desktop", ids: ["org.videolan.VLC.desktop", "mpv.desktop"] });
      expect(parseGioMime("No default applications for “video/x-thing”\nRegistered applications:\n\tmpv.desktop\n")).toEqual({
         defaultId: "",
         ids: ["mpv.desktop"],
      });
   });
   it("reads a desktop entry's name and icon, and skips hidden ones", () => {
      const entry = "[Desktop Entry]\nName=VLC media player\nName[nl]=VLC-mediaspeler\nIcon=vlc\nExec=vlc %U\n[Desktop Action new]\nName=New window\n";
      expect(parseDesktopEntry(entry)).toEqual({ name: "VLC media player", icon: "vlc" });
      expect(parseDesktopEntry("[Desktop Entry]\nName=Helper\nNoDisplay=true\n")).toBeNull();
   });
   it("looks for desktop entries where the XDG spec puts them", () => {
      const directories = linuxDataDirectories({ XDG_DATA_DIRS: "/usr/share:relative/share" }, "/home/me");
      expect(directories.slice(0, 2)).toEqual(["/home/me/.local/share", "/usr/share"]);
      expect(directories).not.toContain("relative/share");
      expect(desktopEntryCandidates(["/usr/share"], "kde-dragon.desktop")).toEqual([
         "/usr/share/applications/kde-dragon.desktop",
         "/usr/share/applications/kde/dragon.desktop",
      ]);
   });
});
