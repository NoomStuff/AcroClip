/**
 * A long-running AcroClip that agents can look at and drive without touching the person at the
 * computer. The app runs from out/ with its own profile and collection. On Linux it runs inside the
 * private desktop that the UI tests use: its own X display, D-Bus and audio. On Windows it runs on a
 * Win32 desktop of its own, which keeps its windows off the person's screen, and its main process is
 * patched at launch so it can't take global shortcuts, open links or play sound. Every command
 * attaches over CDP and detaches again, so the app keeps its state between commands. See
 * `bun run agent-app help`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync } from "node:fs";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { z } from "zod";
import { defaultPreferences } from "../src/shared/defaults";
import type { Preferences } from "../src/shared/types";
import { requireTestIsolation } from "./test-isolation";

const home = resolve(".cache/agent-app");
const paths = {
   session: join(home, "session.json"),
   restart: join(home, "restart-requested"),
   host: join(home, "host.log"),
   app: join(home, "app.log"),
   opened: join(home, "opened.txt"),
   profile: join(home, "profile"),
   collection: join(home, "collection"),
   shots: join(home, "shots"),
   bin: join(home, "bin"),
};
const windowsDesktop = "acroclip-agent";
const electron = resolve("node_modules/electron/dist", readFileSync("node_modules/electron/path.txt", "utf8").trim());
const Session = z.object({ runner: z.number(), host: z.number(), app: z.number(), cdp: z.number(), inspector: z.number(), launch: z.number() });
type Session = z.infer<typeof Session>;

const help = `bun run agent-app <command>

  start [--fresh] [--clips N] [--onboarding] [--no-build]
        Build out/ and start the app in a private desktop. The profile and collection in
        .cache/agent-app persist between starts; --fresh clears them. --clips N adds N generated
        clips, --onboarding leaves setup unfinished.
  status                 Whether it runs, and its pids and ports.
  snapshot [selector]    Accessibility tree of the main window (or of one element).
  shot [selector]        Screenshot of the main window or one element. Prints the PNG path.
  click <selector>       Click. Selectors are Playwright's: 'role=button[name="Settings"]',
                         'text=Library', '.clip-card >> nth=0'.
  fill <selector> <text> Replace a field's text.
  press <key>            Press a key in the focused window, e.g. Escape, Control+A.
  eval <js>              Evaluate in the renderer and print JSON. window.acroClip is the app API.
  main <js>              Evaluate in the main process; require("electron") works.
  run <body>             Run an async function body with Playwright's \`page\` for the main window, for
                         steps that must happen back to back. A returned value is printed.
  state                  window.acroClip.state() as JSON.
  logs [lines]           Tail of the app's stdout, its app.log and what it tried to open.
  restart [--no-build]   Rebuild out/ and relaunch with the same profile and collection.
  stop                   Quit the app and tear the private desktop down.`;

const freePort = (): Promise<number> =>
   new Promise((done, fail) => {
      const server = createServer();
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
         const address = server.address();
         server.close(() => (typeof address === "object" && address ? done(address.port) : fail(new Error("No free port"))));
      });
   });

const alive = (pid: number): boolean => {
   try {
      process.kill(pid, 0);
      return true;
   } catch {
      return false;
   }
};

function readSession(): Session | null {
   if (!existsSync(paths.session)) return null;
   const session = Session.parse(JSON.parse(readFileSync(paths.session, "utf8")));
   return alive(session.runner) ? session : null;
}

function requireSession(): Session {
   const session = readSession();
   if (!session) throw new Error("The agent app isn't running. Start it with bun run agent-app start.");
   return session;
}

function build(): void {
   const result = spawnSync(process.execPath, ["x", "electron-vite", "build"], { stdio: ["ignore", "inherit", "inherit"] });
   if (result.status !== 0) throw new Error("electron-vite build failed.");
}

async function cdpReady(session: Session): Promise<boolean> {
   try {
      const targets = z.array(z.object({ type: z.string(), url: z.string() })).parse(await (await fetch(`http://127.0.0.1:${session.cdp}/json/list`)).json());
      return targets.some((target) => target.type === "page" && target.url.includes("renderer/index.html"));
   } catch {
      return false;
   }
}

/** Waits for a launch newer than `after` whose main window has loaded. */
async function waitForLaunch(after: number): Promise<Session> {
   const deadline = Date.now() + 90_000;
   while (Date.now() < deadline) {
      const session = existsSync(paths.session) ? Session.safeParse(JSON.parse(readFileSync(paths.session, "utf8"))) : null;
      if (session?.success && session.data.launch > after && (await cdpReady(session.data))) return session.data;
      if (session?.success && !alive(session.data.runner)) break;
      await delay(250);
   }
   throw new Error(`The app didn't come up. See ${paths.host} and ${paths.app}.`);
}

async function withPage<T>(use: (page: Page) => Promise<T>): Promise<T> {
   const session = requireSession();
   let browser: Browser | undefined;
   try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.cdp}`);
      const page = browser
         .contexts()
         .flatMap((context) => context.pages())
         .find((candidate) => candidate.url().includes("renderer/index.html"));
      if (!page)
         throw new Error(
            "The main window isn't open. It may be hidden in the tray; try: main 'require(\"electron\").BrowserWindow.getAllWindows()[0]?.show()'."
         );
      return await use(page);
   } finally {
      // Detaches only. The app was not launched by this connection and keeps running.
      await browser?.close().catch(() => undefined);
   }
}

/** Runtime.evaluate on the main process through its Node inspector. */
async function evaluateMain(expression: string, inspector = requireSession().inspector): Promise<unknown> {
   const [target] = z.array(z.object({ webSocketDebuggerUrl: z.string() })).parse(await (await fetch(`http://127.0.0.1:${inspector}/json/list`)).json());
   if (!target) throw new Error("The main process inspector has no target.");
   const socket = new WebSocket(target.webSocketDebuggerUrl);
   await new Promise<void>((done, fail) => {
      socket.addEventListener("open", () => done(), { once: true });
      socket.addEventListener("error", () => fail(new Error("Couldn't reach the main process inspector.")), { once: true });
   });
   try {
      const Reply = z.object({
         id: z.number(),
         result: z.object({
            result: z.object({ value: z.unknown().optional(), description: z.string().optional() }),
            exceptionDetails: z.object({ text: z.string(), exception: z.object({ description: z.string().optional() }).optional() }).optional(),
         }),
      });
      const reply = await new Promise<z.infer<typeof Reply>>((done) => {
         socket.addEventListener("message", (event) => {
            const parsed = Reply.safeParse(JSON.parse(String(event.data)));
            if (parsed.success && parsed.data.id === 1) done(parsed.data);
         });
         socket.send(
            JSON.stringify({
               id: 1,
               method: "Runtime.evaluate",
               params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true, replMode: true },
            })
         );
      });
      const failure = reply.result.exceptionDetails;
      if (failure) throw new Error(failure.exception?.description ?? failure.text);
      return reply.result.result.value ?? reply.result.result.description;
   } finally {
      socket.close();
   }
}

/**
 * The private Win32 desktop only holds windows. Global shortcuts share one table with the person's
 * desktop, and sound, toasts and opened links reach them too, so the profile turns sounds off and the
 * main process is patched at launch.
 */
const windowsQuiet = {
   notificationStartSound: false,
   notificationStopSound: false,
   notificationSaveSound: false,
   notificationErrorSound: false,
} satisfies Partial<Preferences>;

/** Records what the app opens and registers instead of doing it, and mutes its pages. */
const windowsPatch = (opened: string): string => `{
   // Until Electron hooks module loading, "electron" resolves to the npm package, and requiring it then would cache that for this context.
   if (require.resolve("electron") !== "electron") throw new Error("Electron hasn't loaded yet.");
   const { app, dialog, globalShortcut, Notification, shell, webContents } = require("electron");
   globalShortcut.unregisterAll();
   const { appendFileSync } = require("node:fs");
   const record = (kind, value) => appendFileSync(${JSON.stringify(opened)}, kind + " " + value + "\\n");
   shell.openExternal = async (url) => record("link", url);
   shell.openPath = async (path) => (record("path", path), "");
   shell.showItemInFolder = (path) => record("folder", path);
   globalShortcut.register = (accelerator) => (record("shortcut", accelerator), true);
   globalShortcut.registerAll = (accelerators) => accelerators.forEach((accelerator) => record("shortcut", accelerator));
   Notification.prototype.show = function () { record("notification", this.title); };
   // Electron reports a main process crash in a modal box, which nobody could close on this desktop.
   dialog.showErrorBox = (title, content) => record("error", title + ": " + content);
   for (const contents of webContents.getAllWebContents()) contents.setAudioMuted(true);
   app.on("web-contents-created", (_event, contents) => contents.setAudioMuted(true));
   "patched";
}`;

/** Patches a new launch as soon as its main process inspector answers, or stops it. */
async function patchWindowsApp(inspector: number, child: ChildProcess): Promise<void> {
   const deadline = Date.now() + 30_000;
   let failure: unknown = "it never answered";
   while (Date.now() < deadline && child.exitCode === null) {
      try {
         if ((await evaluateMain(windowsPatch(paths.opened), inspector)) === "patched") return;
      } catch (error) {
         failure = error;
      }
      await delay(50);
   }
   child.kill();
   throw new Error(`Couldn't patch the main process, so the app was stopped: ${failure instanceof Error ? failure.message : String(failure)}`);
}

async function seed(clips: number, onboarding: boolean): Promise<void> {
   await mkdir(paths.profile, { recursive: true });
   await mkdir(paths.collection, { recursive: true });
   const preferences = join(paths.profile, "preferences.json");
   const saved: Record<string, unknown> = existsSync(preferences)
      ? z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(preferences, "utf8")))
      : {
           ...defaultPreferences,
           collection: paths.collection,
           setupComplete: !onboarding,
           audioSources: [],
           audioSourcesVersion: undefined,
           captureAudio: false,
        };
   // Reapplied on every start, so sounds turned on during a session stay off.
   await writeFile(preferences, JSON.stringify(process.platform === "win32" ? { ...saved, ...windowsQuiet } : saved));
   const existing = (await readdir(paths.collection)).filter((name) => name.endsWith(".mp4")).length;
   const bundled = resolve("resources/media", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
   const ffmpeg = existsSync(bundled) ? bundled : (process.env["FFMPEG_PATH"] ?? "ffmpeg");
   for (let index = existing; index < existing + clips; index++) {
      const result = spawnSync(ffmpeg, [
         ...["-v", "error", "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30`, "-f", "lavfi", "-i", `sine=frequency=${300 + index * 40}`],
         ...["-t", String(4 + (index % 5) * 3), "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest"],
         join(paths.collection, `Generated clip ${index + 1}.mp4`),
      ]);
      if (result.status !== 0) throw new Error(`ffmpeg couldn't generate a clip: ${result.stderr.toString()}`);
   }
}

/** Runs inside run-linux-ui.py, or on the private Win32 desktop. Launches the app and relaunches it when a restart was requested. */
async function host(): Promise<void> {
   const windows = process.platform === "win32";
   // The Windows host has no console, so both hosts write their log directly.
   const say = (line: string) => appendFileSync(paths.host, `${line}\n`);
   if (windows) {
      const { currentDesktop, openDesktop } = await import("./windows-desktop");
      if (currentDesktop() !== windowsDesktop) throw new Error(`The host must run on the ${windowsDesktop} desktop. Use bun run agent-app start.`);
      // Held for the host's lifetime, so the desktop outlives the start command that created it.
      openDesktop(windowsDesktop);
   } else {
      requireTestIsolation();
      // Links and folders the app opens are recorded instead of opening on the private desktop.
      await mkdir(paths.bin, { recursive: true });
      await writeFile(join(paths.bin, "xdg-open"), `#!/bin/sh\nprintf '%s\\n' "$1" >> '${paths.opened}'\n`);
      await chmod(join(paths.bin, "xdg-open"), 0o755);
   }
   // run-linux-ui.py starts the Linux host directly, so its parent owns the private desktop. A Win32
   // desktop needs no process of its own, so there the host is the whole session.
   const runner = windows ? process.pid : process.ppid;
   for (let launch = 1; ; launch++) {
      const [cdp, inspector] = [await freePort(), await freePort()];
      const log = openSync(paths.app, "a");
      const child = spawn(electron, [resolve("."), "--disable-gpu-sandbox", `--remote-debugging-port=${cdp}`, `--inspect=127.0.0.1:${inspector}`], {
         stdio: ["ignore", log, log],
         env: {
            ...process.env,
            ACROCLIP_TEST: "1",
            ACROCLIP_PROFILE: paths.profile,
            ...(windows ? {} : { PATH: `${paths.bin}${delimiter}${process.env["PATH"] ?? ""}` }),
         },
      });
      const exited = new Promise<number | null>((done) => child.once("exit", done));
      if (windows) await patchWindowsApp(inspector, child);
      const session: Session = { runner, host: process.pid, app: child.pid ?? 0, cdp, inspector, launch };
      await writeFile(paths.session, JSON.stringify(session));
      say(`Launch ${launch}: app ${child.pid}, CDP ${cdp}, inspector ${inspector}`);
      say(`App exited with ${await exited}`);
      if (!existsSync(paths.restart)) break;
      await rm(paths.restart);
   }
   await rm(paths.session, { force: true });
}

async function start(args: string[]): Promise<void> {
   if (process.platform !== "linux" && process.platform !== "win32")
      throw new Error("The agent app needs a private Linux or Windows desktop. On macOS, use the Playwright UI tests.");
   const running = readSession();
   if (running) {
      console.log(`Already running (launch ${running.launch}, CDP ${running.cdp}). Use restart to pick up changes.`);
      return;
   }
   const option = (name: string) => args.indexOf(name);
   if (option("--fresh") >= 0) await rm(home, { recursive: true, force: true });
   await mkdir(home, { recursive: true });
   const clipsAt = option("--clips");
   await seed(
      clipsAt >= 0
         ? z.coerce
              .number()
              .int()
              .min(0)
              .max(200)
              .parse(args[clipsAt + 1])
         : 0,
      option("--onboarding") >= 0
   );
   if (option("--no-build") < 0) build();
   await rm(paths.session, { force: true });
   await rm(paths.restart, { force: true });
   await writeFile(paths.host, "");
   const hostCommand = ["scripts/agent-app.ts", "host"];
   if (process.platform === "win32") {
      const { openDesktop, spawnOnDesktop } = await import("./windows-desktop");
      // Held until this command exits, by which time the host holds its own handle.
      openDesktop(windowsDesktop);
      spawnOnDesktop(windowsDesktop, process.execPath, hostCommand, process.cwd(), process.env);
   } else {
      const log = openSync(paths.host, "a");
      spawn("python3", ["scripts/run-linux-ui.py", process.execPath, ...hostCommand], { detached: true, stdio: ["ignore", log, log] }).unref();
   }
   const session = await waitForLaunch(0);
   console.log(`AcroClip is running in a private desktop (CDP ${session.cdp}). Profile: ${paths.profile}, collection: ${paths.collection}`);
}

async function stop(): Promise<void> {
   const session = readSession();
   if (!session) {
      console.log("The agent app isn't running.");
      return;
   }
   await rm(paths.restart, { force: true });
   await evaluateMain('require("electron").app.exit(0)').catch(() => undefined);
   const deadline = Date.now() + 15_000;
   while (alive(session.runner) && Date.now() < deadline) await delay(200);
   if (alive(session.runner)) {
      if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(session.runner)], { stdio: "ignore" });
      else process.kill(-session.runner, "SIGTERM");
   }
   await rm(paths.session, { force: true });
   console.log("Stopped.");
}

const print = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
const [command = "help", ...args] = process.argv.slice(2);
const required = (index: number, name: string): string => {
   const value = args[index];
   if (value === undefined) throw new Error(`Pass ${name}. See bun run agent-app help.`);
   return value;
};

switch (command) {
   case "host":
      await host().catch((failure: unknown) => {
         appendFileSync(paths.host, `${failure instanceof Error ? (failure.stack ?? failure.message) : String(failure)}\n`);
         process.exit(1);
      });
      break;
   case "start":
      await start(args);
      break;
   case "stop":
      await stop();
      break;
   case "status": {
      const session = readSession();
      print(session ? { running: true, ...session, profile: paths.profile, collection: paths.collection } : { running: false });
      break;
   }
   case "restart": {
      const session = requireSession();
      if (!args.includes("--no-build")) build();
      await writeFile(paths.restart, "");
      await evaluateMain('require("electron").app.exit(0)').catch(() => undefined);
      const next = await waitForLaunch(session.launch);
      console.log(`Relaunched (launch ${next.launch}).`);
      break;
   }
   case "snapshot":
      print(await withPage((page) => page.locator(args[0] ?? "body").ariaSnapshot()));
      break;
   case "shot": {
      await mkdir(paths.shots, { recursive: true });
      const file = join(paths.shots, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
      await withPage((page) => (args[0] ? page.locator(args[0]).screenshot({ path: file }) : page.screenshot({ path: file })));
      print(file);
      break;
   }
   case "click":
      await withPage((page) => page.locator(required(0, "a selector")).click({ timeout: 10_000 }));
      break;
   case "fill":
      await withPage((page) => page.locator(required(0, "a selector")).fill(required(1, "the text"), { timeout: 10_000 }));
      break;
   case "press":
      await withPage((page) => page.keyboard.press(required(0, "a key")));
      break;
   case "eval":
      print(await withPage((page) => page.evaluate(`(async () => (${required(0, "an expression")}))()`)));
      break;
   case "run": {
      // An async function body with the main window's Playwright `page` in scope, for steps that must run back to back.
      const body = required(0, "a script body");
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...parameters: string[]) => (page: Page) => Promise<unknown>;
      const result = await withPage((page) => new AsyncFunction("page", body)(page));
      if (result !== undefined) print(result);
      break;
   }
   case "state":
      print(await withPage((page) => page.evaluate(() => window.acroClip.state())));
      break;
   case "main":
      print(await evaluateMain(required(0, "an expression")));
      break;
   case "logs": {
      const lines = z.coerce
         .number()
         .int()
         .positive()
         .parse(args[0] ?? 40);
      const tail = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n") : "(none)");
      print(
         [`== app stdout (${paths.app})`, tail(paths.app), `== app.log`, tail(join(paths.profile, "logs", "app.log")), `== opened`, tail(paths.opened)].join(
            "\n"
         )
      );
      break;
   }
   default:
      print(help);
}
