import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { desktopExec, linuxDesktopIdentity, linuxDesktopName, linuxStartup, xdgDirectory } from "./startup";

describe("Linux packaged portal identity", () => {
   it("creates a matching desktop entry and updates only entries it owns", async () => {
      const directory = await mkdtemp(join(tmpdir(), "acroclip-desktop-"));
      const file = join(directory, "applications", linuxDesktopName);
      const icon = join(directory, "source-icon.png");
      await writeFile(icon, "isolated app icon");
      await linuxDesktopIdentity(directory, "/apps/My App%.AppImage", icon);
      const initial = await readFile(file, "utf8");
      expect(initial).toContain('"/apps/My App%%.AppImage"');
      expect(initial).toContain("StartupWMClass=dev.acroclip.app");
      expect(initial).toContain("Icon=dev.acroclip.app");
      expect(await readFile(join(directory, "icons", "hicolor", "256x256", "apps", "dev.acroclip.app.png"), "utf8")).toBe("isolated app icon");
      await linuxDesktopIdentity(directory, "/apps/new.AppImage", icon);
      expect(await readFile(file, "utf8")).toContain('Exec="/apps/new.AppImage"');
      await writeFile(file, "[Desktop Entry]\nName=My custom launcher\n");
      await linuxDesktopIdentity(directory, "/apps/third.AppImage", "/apps/icon.png");
      expect(await readFile(file, "utf8")).toBe("[Desktop Entry]\nName=My custom launcher\n");
   });
   it("rejects paths that inject desktop entry keys", async () => {
      const directory = await mkdtemp(join(tmpdir(), "acroclip-desktop-"));
      await expect(linuxDesktopIdentity(directory, "/apps/app\nExec=other", "/apps/icon.png")).rejects.toThrow("app path");
      await expect(linuxDesktopIdentity(directory, "/apps/app", "/apps/icon\nHidden=true")).rejects.toThrow("app path");
   });
});

describe("Linux launcher configuration", () => {
   it("ignores unset, empty and relative XDG paths", () => {
      for (const value of [undefined, "", "relative/config"]) expect(xdgDirectory(value, "/home/test/.config")).toBe("/home/test/.config");
      expect(xdgDirectory("/custom/config", "/fallback")).toBe("/custom/config");
   });
   it("escapes both desktop string and command argument layers", () => {
      const source = '/apps/quote" dollar$ tick` slash\\ percent%.AppImage';
      const command = desktopExec(source, []);
      const decoded = command.replace(/\\([\\tnr])/g, (_, char: string) => ({ t: "\t", n: "\n", r: "\r" })[char] ?? char);
      const argument = decoded
         .slice(decoded.indexOf('"/apps/') + 1, -1)
         .replace(/\\([\\"`$])/g, "$1")
         .replaceAll("%%", "%");
      expect(argument).toBe(source);
      expect(command).toContain("\\\\\\\\");
   });
   it("rejects autostart entry injection before writing", async () => {
      const directory = await mkdtemp(join(tmpdir(), "acroclip-autostart-"));
      await expect(linuxStartup(true, directory, "/apps/app", ["bad\nHidden=true"])).rejects.toThrow("app path");
      await linuxStartup(true, directory, "/apps/My App", ["--clip"]);
      expect(await readFile(join(directory, "autostart", "acroclip.desktop"), "utf8")).toContain('Exec="/apps/My App" "--clip"');
      await linuxStartup(false, directory, "/apps/My App", []);
      await expect(readFile(join(directory, "autostart", "acroclip.desktop"))).rejects.toThrow();
   });
});
