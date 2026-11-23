import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, posix } from "node:path";
import { z } from "zod";
import type { OpenWithApp, OpenWithList } from "../shared/types";
import { launchEnvironment } from "./launch-environment";

/**
 * The apps a clip can open with, like a file manager's Open with menu: the system default and the
 * others it recommends for the file type. Windows asks the shell through AcroClip's helper, macOS
 * asks Launch Services, Linux reads `gio mime` and the apps' desktop entries. Lists are per file
 * type and kept for a few minutes. An app only opens a file if it came from that list.
 */
export interface OpenWithPlatform {
   /** The apps for this file's type. Empty when the system can't say. */
   list(path: string): Promise<{ apps: OpenWithApp[]; canChoose: boolean }>;
   open(path: string, app: OpenWithApp): Promise<void>;
   /** The system's own picker for any installed app. Windows only. */
   choose?(path: string): Promise<void>;
}

const listLifetime = 5 * 60_000;
const maximumApps = 16;

export class OpenWith {
   private readonly lists = new Map<string, { at: number; list: Promise<OpenWithList> }>();
   private readonly platform: OpenWithPlatform | null;
   constructor(platform: OpenWithPlatform | null) {
      this.platform = platform;
   }

   list(path: string): Promise<OpenWithList> {
      const empty: OpenWithList = { apps: [], canChoose: false };
      if (!this.platform) return Promise.resolve(empty);
      const type = fileType(path);
      const cached = this.lists.get(type);
      if (cached && Date.now() - cached.at < listLifetime) return cached.list;
      const list = this.platform.list(path).then(
         (value) => ({ apps: value.apps.slice(0, maximumApps), canChoose: value.canChoose }),
         // The menu falls back to the default app, so a system that can't list apps isn't an error.
         () => empty
      );
      this.lists.set(type, { at: Date.now(), list });
      void list.then((value) => {
         if (!value.apps.length && !value.canChoose) this.lists.delete(type);
      });
      return list;
   }

   async open(path: string, id: string): Promise<void> {
      const app = (await this.list(path)).apps.find((item) => item.id === id);
      if (!app || !this.platform) throw new Error("That app is no longer available for this file. Open the menu again to see the current apps.");
      await this.platform.open(path, app);
   }

   async choose(path: string): Promise<void> {
      if (!this.platform?.choose) throw new Error("Choosing another app isn't available on this system.");
      await this.platform.choose(path);
   }
}

const fileType = (path: string) => (extname(path) || ".").toLowerCase();

interface Run {
   stdout: string;
   code: number | null;
}
function run(file: string, args: string[], environment: NodeJS.ProcessEnv, timeout = 10_000): Promise<Run> {
   return new Promise((resolve, reject) => {
      execFile(file, args, { env: environment, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
         if (error && (error as NodeJS.ErrnoException).code === "ENOENT") reject(error);
         else resolve({ stdout: String(stdout), code: error ? ((error as { code?: number }).code ?? 1) : 0 });
      });
   });
}

const helperListSchema = z
   .array(z.object({ id: z.string().min(1).max(4096), name: z.string().min(1).max(300), icon: z.string().max(400_000), default: z.boolean() }))
   .max(64);

/** Windows: AcroClip's helper asks the shell for Explorer's Open with list, and opens through the same handlers. */
export function windowsOpenWith(helper: string, environment: NodeJS.ProcessEnv = process.env): OpenWithPlatform {
   return {
      async list(path) {
         if (!existsSync(helper)) return { apps: [], canChoose: false };
         const result = await run(helper, ["--open-with-list"], { ...environment, ACROCLIP_EXTENSION: fileType(path) });
         if (result.code !== 0) return { apps: [], canChoose: true };
         const apps = helperListSchema.parse(JSON.parse(result.stdout.trim() || "[]"));
         return {
            apps: apps.map((app) => ({
               id: app.id,
               name: app.name,
               icon: app.icon.startsWith("data:image/png;base64,") ? app.icon : "",
               isDefault: app.default,
            })),
            canChoose: true,
         };
      },
      async open(path, app) {
         const result = await run(helper, ["--open-with"], { ...environment, ACROCLIP_FILE: path, ACROCLIP_HANDLER: app.id });
         if (result.code !== 0 || !result.stdout.includes("opened")) throw new Error(`${app.name} couldn't open this file.`);
      },
      choose(path) {
         // The dialog stays open until the person picks an app, so this only waits for it to start.
         return new Promise((resolve, reject) => {
            const child = spawn(helper, ["--open-with-choose"], { env: { ...environment, ACROCLIP_FILE: path }, stdio: "ignore", windowsHide: false });
            child.once("error", () => reject(new Error("Couldn't show the list of apps.")));
            child.once("spawn", () => {
               child.unref();
               resolve();
            });
         });
      },
   };
}

/**
 * macOS: Launch Services, through JavaScript for Automation, lists the apps that can open the file.
 * Each app's own icon comes from `icon`, and `open -a` hands it the file.
 */
const launchServicesScript = `
ObjC.import("AppKit");
function run(argv) {
   const workspace = $.NSWorkspace.sharedWorkspace;
   const url = $.NSURL.fileURLWithPath(argv[0]);
   const fallback = workspace.URLForApplicationToOpenURL(url);
   const fallbackPath = fallback.isNil() ? "" : ObjC.unwrap(fallback.path);
   const paths = [];
   try {
      const urls = workspace.URLsForApplicationsToOpenURL(url);
      for (let index = 0; index < urls.count; index++) paths.push(ObjC.unwrap(urls.objectAtIndex(index).path));
   } catch (error) {
      // Before macOS 12 only the default app can be asked for.
   }
   if (fallbackPath && !paths.includes(fallbackPath)) paths.unshift(fallbackPath);
   return JSON.stringify(
      paths.slice(0, ${maximumApps}).map((path) => ({
         path,
         name: ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(path)).replace(/\\.app$/, ""),
         default: path === fallbackPath,
      }))
   );
}`;
const launchServicesSchema = z.array(z.object({ path: z.string().min(1).max(4096), name: z.string().min(1).max(300), default: z.boolean() })).max(256);

export function macOpenWith(icon: (path: string) => Promise<string>, environment: NodeJS.ProcessEnv = process.env): OpenWithPlatform {
   return {
      async list(path) {
         const result = await run("osascript", ["-l", "JavaScript", "-e", launchServicesScript, path], environment);
         if (result.code !== 0) return { apps: [], canChoose: false };
         const apps = launchServicesSchema.parse(JSON.parse(result.stdout.trim() || "[]")).filter((app) => app.path.endsWith(".app"));
         return {
            apps: await Promise.all(
               apps.map(async (app) => ({ id: app.path, name: app.name, icon: await icon(app.path).catch(() => ""), isDefault: app.default }))
            ),
            canChoose: false,
         };
      },
      async open(path, app) {
         const result = await run("open", ["-a", app.id, path], environment);
         if (result.code !== 0) throw new Error(`${app.name} couldn't open this file.`);
      },
   };
}

/** Linux: the video types AcroClip shows, so a list doesn't need the file's contents sniffed. */
const linuxVideoTypes: Record<string, string> = {
   ".mp4": "video/mp4",
   ".m4v": "video/x-m4v",
   ".mov": "video/quicktime",
   ".mkv": "video/x-matroska",
   ".webm": "video/webm",
   ".avi": "video/x-msvideo",
   ".ts": "video/mp2t",
   ".flv": "video/x-flv",
};

/** `gio mime`'s answer: the default app, then the recommended ones, falling back on every registered one. */
export function parseGioMime(output: string): { defaultId: string; ids: string[] } {
   let defaultId = "";
   const sections: Record<string, string[]> = {};
   let section = "";
   for (const line of output.split(/\r?\n/)) {
      const fallback = /^Default application for .*:\s*(\S+\.desktop)\s*$/.exec(line);
      if (fallback) defaultId = fallback[1]!;
      else if (/^\S.*:\s*$/.test(line)) section = line.trim().replace(/:$/, "");
      else if (/^\s+\S+\.desktop\s*$/.test(line) && section) (sections[section] ??= []).push(line.trim());
   }
   const listed = sections["Recommended applications"]?.length ? sections["Recommended applications"] : (sections["Registered applications"] ?? []);
   const ids = [...new Set([...(defaultId ? [defaultId] : []), ...listed])];
   return { defaultId, ids };
}

/** The parts of a desktop entry a menu needs. Null for one that asks not to be shown. */
export function parseDesktopEntry(text: string): { name: string; icon: string } | null {
   let inEntry = false;
   const values: Record<string, string> = {};
   for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("[")) {
         inEntry = line === "[Desktop Entry]";
         continue;
      }
      const match = inEntry ? /^([A-Za-z0-9-]+)\s*=\s*(.*)$/.exec(line) : null;
      if (match && !(match[1]! in values)) values[match[1]!] = match[2]!;
   }
   if (!values["Name"] || values["Hidden"] === "true" || values["NoDisplay"] === "true") return null;
   return { name: values["Name"], icon: values["Icon"] ?? "" };
}

/** Where desktop entries live, most personal first, as the XDG base directory spec orders them. */
export function linuxDataDirectories(environment: NodeJS.ProcessEnv, home = homedir()): string[] {
   const user = environment["XDG_DATA_HOME"] || posix.join(home, ".local/share");
   const system = (environment["XDG_DATA_DIRS"] || "/usr/local/share:/usr/share").split(":").filter((directory) => isAbsolute(directory));
   return [...new Set([user, ...system, posix.join(home, ".local/share/flatpak/exports/share"), "/var/lib/flatpak/exports/share"])];
}

/** A desktop id's file. An id like kde-foo.desktop can also live at kde/foo.desktop. */
export function desktopEntryCandidates(directories: readonly string[], id: string): string[] {
   const nested = id.includes("-") ? [id.replace(/-/g, "/")] : [];
   return directories.flatMap((directory) => [id, ...nested].map((name) => posix.join(directory, "applications", name)));
}

const iconSizes = ["48x48", "64x64", "32x32", "128x128", "256x256"];
async function linuxIcon(name: string, directories: readonly string[]): Promise<string> {
   if (!name) return "";
   const candidates = isAbsolute(name)
      ? [name]
      : [
           ...directories.flatMap((directory) => [
              ...iconSizes.map((size) => posix.join(directory, "icons/hicolor", size, "apps", `${name}.png`)),
              posix.join(directory, "icons/hicolor/scalable/apps", `${name}.svg`),
           ]),
           `/usr/share/pixmaps/${name}.png`,
           `/usr/share/pixmaps/${name}.svg`,
        ];
   for (const file of candidates) {
      if (!existsSync(file)) continue;
      const bytes = await readFile(file).catch(() => null);
      if (!bytes || bytes.length > 512 * 1024) continue;
      return `data:${file.endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${bytes.toString("base64")}`;
   }
   return "";
}

export function linuxOpenWith(environment: NodeJS.ProcessEnv = process.env): OpenWithPlatform {
   const clean = launchEnvironment(environment);
   // Only the queries run in the C locale, so their output parses. Apps open in the person's own.
   const plain = { ...clean, LC_ALL: "C", LANGUAGE: "" };
   const entries = new Map<string, string>();
   return {
      async list(path) {
         let type = linuxVideoTypes[fileType(path)];
         if (!type) type = (await run("xdg-mime", ["query", "filetype", path], plain)).stdout.trim();
         if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) return { apps: [], canChoose: false };
         const answer = await run("gio", ["mime", type], plain);
         if (answer.code !== 0) return { apps: [], canChoose: false };
         const { defaultId, ids } = parseGioMime(answer.stdout);
         const directories = linuxDataDirectories(clean);
         const apps: OpenWithApp[] = [];
         for (const id of ids) {
            if (apps.length >= maximumApps) break;
            for (const file of desktopEntryCandidates(directories, id)) {
               const entry = existsSync(file) ? parseDesktopEntry(await readFile(file, "utf8").catch(() => "")) : null;
               if (!entry) continue;
               entries.set(id, file);
               apps.push({ id, name: entry.name, icon: await linuxIcon(entry.icon, directories), isDefault: id === defaultId });
               break;
            }
         }
         return { apps, canChoose: false };
      },
      async open(path, app) {
         const file = entries.get(app.id);
         // gio launches the entry with its own Exec line and file handling. Older systems have gtk-launch.
         if (file && (await launch("gio", ["launch", file, path], clean)) === 0) return;
         if ((await launch("gtk-launch", [app.id.replace(/\.desktop$/, ""), path], clean)) !== 0) throw new Error(`${app.name} couldn't open this file.`);
      },
   };
}

/**
 * Runs a launcher that starts an app and exits. The app inherits nothing from AcroClip's pipes, which
 * would otherwise keep the launcher's output open for as long as the app runs.
 */
function launch(file: string, args: string[], environment: NodeJS.ProcessEnv): Promise<number | null> {
   return new Promise((resolve) => {
      const child = spawn(file, args, { env: environment, stdio: "ignore", detached: true });
      // A launcher still running after this long has handed the file over, as far as anyone can tell.
      const timer = setTimeout(() => {
         child.unref();
         resolve(0);
      }, 5_000);
      child.once("error", () => {
         clearTimeout(timer);
         resolve(null);
      });
      child.once("exit", (code) => {
         clearTimeout(timer);
         resolve(code);
      });
   });
}

export function openWithPlatform(options: { helper: string; icon: (path: string) => Promise<string> }): OpenWithPlatform | null {
   if (process.platform === "win32") return windowsOpenWith(options.helper);
   if (process.platform === "darwin") return macOpenWith(options.icon);
   if (process.platform === "linux") return linuxOpenWith();
   return null;
}
