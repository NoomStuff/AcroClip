import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: {} }));
const { launchEnvironment } = await import("./launch-environment");

describe("launch environment", () => {
   it("gives an app opened from the AppImage the environment from before it mounted", () => {
      // What AppRun and Chromium set for 0.30.2's AppImage, read from its recorder's environment.
      const mount = "/tmp/.mount_AcroCliPToio";
      const environment = {
         HOME: "/home/someone",
         LANG: "nl_NL.UTF-8",
         APPDIR: mount,
         APPIMAGE: "/home/someone/AcroClip.AppImage",
         ARGV0: "./AcroClip.AppImage",
         OWD: "/home/someone",
         PATH: `${mount}:${mount}/usr/sbin:/usr/local/bin:/usr/bin`,
         LD_LIBRARY_PATH: `${mount}/usr/lib`,
         XDG_DATA_DIRS: `${mount}/usr/share/:/usr/share/gnome:/usr/local/share/:/usr/share/`,
         GSETTINGS_SCHEMA_DIR: `${mount}/usr/share/glib-2.0/schemas`,
         CHROME_DESKTOP: "dev.acroclip.app.desktop",
         NO_AT_BRIDGE: "1",
         FC_FONTATIONS: "1",
         EGL_PLATFORM: "wayland",
         GIO_LAUNCHED_DESKTOP_FILE: "/usr/share/applications/dev.acroclip.app.desktop",
         GIO_LAUNCHED_DESKTOP_FILE_PID: "4120",
      };
      expect(launchEnvironment(environment)).toEqual({
         HOME: "/home/someone",
         LANG: "nl_NL.UTF-8",
         PATH: "/usr/local/bin:/usr/bin",
         XDG_DATA_DIRS: "/usr/share/gnome:/usr/local/share/:/usr/share/",
      });
   });

   it("keeps the person's own library paths and similarly named folders", () => {
      const result = launchEnvironment({
         APPDIR: "/tmp/.mount_Acro/",
         LD_LIBRARY_PATH: "/tmp/.mount_Acro/usr/lib:/opt/cuda/lib64:/tmp/.mount_Across/lib",
         PATH: "/usr/bin",
      });
      expect(result["LD_LIBRARY_PATH"]).toBe("/opt/cuda/lib64:/tmp/.mount_Across/lib");
      expect(result["PATH"]).toBe("/usr/bin");
   });

   it("leaves paths alone outside an AppImage", () => {
      const environment = { PATH: "/opt/app:/usr/bin", LD_LIBRARY_PATH: "/opt/app/lib", CHROME_DESKTOP: "acroclip.desktop" };
      expect(launchEnvironment(environment)).toEqual({ PATH: "/opt/app:/usr/bin", LD_LIBRARY_PATH: "/opt/app/lib" });
      // An APPDIR of the root folder would otherwise take every path with it.
      expect(launchEnvironment({ APPDIR: "/", PATH: "/usr/bin" })["PATH"]).toBe("/usr/bin");
   });
});
