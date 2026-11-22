import { spawn } from "node:child_process";
import { posix } from "node:path";
import { shell } from "electron";

/** Set by Chromium inside AcroClip before any of its code runs, so they were never the person's. */
const chromiumVariables = ["CHROME_DESKTOP", "NO_AT_BRIDGE", "FC_FONTATIONS", "EGL_PLATFORM"];
/** Describe how AcroClip itself started, and mean nothing to another app. */
const launchVariables = ["GIO_LAUNCHED_DESKTOP_FILE", "GIO_LAUNCHED_DESKTOP_FILE_PID", "XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"];
const appImageVariables = ["APPDIR", "APPIMAGE", "ARGV0", "OWD"];
/** The AppImage's AppRun puts its mounted folders in front of these. */
const appImageLists = ["PATH", "LD_LIBRARY_PATH", "XDG_DATA_DIRS", "GSETTINGS_SCHEMA_DIR"];

/**
 * The environment for an app AcroClip opens on Linux, as if the person had opened it themselves.
 * Without this, an app opened from the AppImage loads AcroClip's bundled libraries, a Chromium
 * browser groups its windows under AcroClip, and GTK apps start with accessibility turned off.
 */
export function launchEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
   const result: NodeJS.ProcessEnv = { ...environment };
   for (const key of [...chromiumVariables, ...launchVariables]) delete result[key];
   const root = environment["APPDIR"];
   if (!root || !posix.isAbsolute(root) || posix.normalize(root) === "/") return result;
   const mount = posix.normalize(root).replace(/\/$/, "");
   const inside = (entry: string) => {
      const normalized = posix.normalize(entry);
      return normalized === mount || normalized.startsWith(`${mount}/`);
   };
   for (const key of appImageVariables) delete result[key];
   for (const key of appImageLists) {
      const value = environment[key];
      if (value === undefined) continue;
      const kept = value.split(":").filter((entry) => entry && !inside(entry));
      if (kept.length) result[key] = kept.join(":");
      else delete result[key];
   }
   return result;
}

/** How long a failing opener takes to say so. One still running by then has started the app. */
const openerAnswer = 600;

/**
 * Opens a file, folder or link in the person's default app with `xdg-open`, which is what
 * Electron's shell does, but with a clean environment. On desktops without their own opener,
 * `xdg-open` runs the app in the foreground, so it only waits long enough to hear a quick failure.
 */
export function openOnLinux(target: string, environment: NodeJS.ProcessEnv = process.env): Promise<boolean> {
   return new Promise((resolve) => {
      const child = spawn("xdg-open", [target], { env: launchEnvironment(environment), stdio: "ignore", detached: true });
      const timer = setTimeout(() => {
         child.unref();
         resolve(true);
      }, openerAnswer);
      child.once("error", () => {
         clearTimeout(timer);
         resolve(false);
      });
      child.once("exit", (code) => {
         clearTimeout(timer);
         resolve(code === 0);
      });
   });
}

/** Electron's `shell.openPath`, opening Linux apps with a clean environment. Empty when it opened. */
export async function openPath(path: string): Promise<string> {
   if (process.platform !== "linux") return shell.openPath(path);
   return (await openOnLinux(path)) ? "" : "No app opened it.";
}

/** Electron's `shell.openExternal`, opening the Linux browser with a clean environment. */
export async function openExternal(url: string): Promise<void> {
   if (process.platform !== "linux") return shell.openExternal(url);
   if (!(await openOnLinux(url))) throw new Error("No browser opened the link.");
}
