import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function desktopExec(executable: string, args: string[]): string {
   const quote = (value: string) => `"${value.replaceAll("%", "%%").replace(/[\\"`$]/g, "\\$&")}"`;
   return [executable, ...args].map(quote).join(" ");
}
export const linuxDesktopName = "dev.acroclip.app.desktop";
export async function linuxDesktopIdentity(dataDirectory: string, executable: string, icon: string): Promise<void> {
   const directory = join(dataDirectory, "applications");
   const file = join(directory, linuxDesktopName);
   const marker = "X-AcroClip-Managed=true";
   try {
      const existing = await readFile(file, "utf8");
      if (!existing.split(/\r?\n/).includes(marker)) return;
   } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
   }
   if (/[\r\n\0]/.test(executable) || /[\r\n\0]/.test(icon)) throw new Error("The app path cannot be used for desktop integration.");
   await mkdir(directory, { recursive: true });
   const icons = join(dataDirectory, "icons", "hicolor", "256x256", "apps");
   await mkdir(icons, { recursive: true });
   await copyFile(icon, join(icons, "dev.acroclip.app.png"));
   const temporary = join(directory, `.${linuxDesktopName}.${randomUUID()}.tmp`);
   try {
      await writeFile(
         temporary,
         `[Desktop Entry]\nType=Application\nName=AcroClip\nExec=${desktopExec(executable, [])}\nIcon=dev.acroclip.app\nTerminal=false\nCategories=AudioVideo;\nStartupWMClass=dev.acroclip.app\n${marker}\n`,
         { flag: "wx" }
      );
      await rename(temporary, file);
   } finally {
      await rm(temporary, { force: true });
   }
}
export async function linuxStartup(enabled: boolean, configDirectory: string, executable: string, args: string[]): Promise<void> {
   const directory = join(configDirectory, "autostart");
   const path = join(directory, "acroclip.desktop");
   if (!enabled) {
      await rm(path, { force: true });
      return;
   }
   await mkdir(directory, { recursive: true });
   await writeFile(
      path,
      `[Desktop Entry]\nType=Application\nName=AcroClip\nExec=${desktopExec(executable, args)}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`
   );
}
