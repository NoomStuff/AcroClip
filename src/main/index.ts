import { shareableTargetAllowed } from "../shared/shareable-target";
import { normalizeApplicationLabel } from "./application-identity";
import { isPackagedApp, registerWindowsIdentity, windowsAppId } from "./identity";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, protocol, shell, Tray, session, systemPreferences, screen } from "electron";
import { mkdirSync, realpathSync } from "node:fs";
import { appendFile, mkdir, realpath, stat, rename as renameFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppEvent, AppState, NoticeOptions, Preferences, RecorderState } from "../shared/types";
import { recordingArtwork, type RecordingArtwork } from "./recording-artwork";
import { categoryRequest, idSchema } from "../shared/validation";
import { assertDistinctAudioSources } from "./audio-sources";
import { audioTopology, synchronizeLegacyAudio, monitoringPreferences } from "../shared/audio-model";
import { mergePreferenceChanges, readPreferences, requiresCaptureRestart, writePreferences } from "./preferences";
import { CollectionService, withinRoot } from "./collection";
import { isValidShortcut, recordingDestination, recordingSourceLabel, samePath } from "./safety";
import { bindingFor, shortcutRegistry, shortcutConflict } from "../shared/shortcuts";
import type { ShortcutAction } from "../shared/shortcuts";
import { Recorder } from "./recorder";
import { CaptureSources } from "./capture-sources";
import { serveMedia } from "./serve";
import { BACKGROUND_CHECK_INTERVAL, Updates } from "./updates";
import { testUpdateServer } from "./update-manager";
import { isWaylandSession } from "./linux-session";
import { linuxDesktopIdentity, linuxStartup, linuxDesktopName, xdgDirectory } from "./startup";
import { pendingExitDecision } from "./lifecycle";
import { Feedback } from "./feedback";
import { bufferedCaptureSource, portalScreenId, selectedCaptureSource, previewCaptureSource } from "../shared/capture-policy";
import { attaCutEnvironment, findAttaCut } from "./attacut";
import { needsMicrophonePermission } from "../shared/audio-policy";
import { StorageMonitor } from "./storage";
import { StateChanges } from "./state-changes";
import { updateTray as renderTray } from "./tray";

protocol.registerSchemesAsPrivileged([{ scheme: "acroclip-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const here = dirname(fileURLToPath(import.meta.url));
const testProfile = process.env["ACROCLIP_PROFILE"];
if (testProfile) app.setPath("userData", resolve(testProfile));
app.setName("AcroClip");
if (process.platform === "linux") app.setDesktopName(linuxDesktopName);
if (process.platform === "win32") app.setAppUserModelId(windowsAppId());
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let exiting: Promise<boolean> | null = null;
let preferences: Preferences;
let preferencePath = "";
let refreshBusy = false;
let closingRequested = false;
let preferenceWrites: Promise<unknown> = Promise.resolve();
let collectionReady: Promise<void> = Promise.resolve();
let startingCapture: Promise<void> | null = null;
let previewSourceId: string | null = null;
let previewOwner: string | null = null;
let playbackRequest: { id: string; controller: AbortController } | undefined;
const mediaFiles = new Map<string, string>();
const mediaKeys = new Map<string, string>();
const stateChanges = new StateChanges();
const collections = new CollectionService({
   applications: () =>
      captureSources.cached
         .filter((source) => source.applicationId)
         .map((source) => ({ id: source.applicationId!, icon: source.appIcon ?? "", ...(source.applicationName ? { name: source.applicationName } : {}) })),
   beforeFolderChange: () => {
      if (recorder.status.pendingSaves) throw new Error("Wait for clips to finish saving before changing folders.");
   },
   scanConcurrency: () => (["recording", "waiting", "starting"].includes(recorder.status.state) || startingCapture ? 1 : 3),
   onChange: () => emitState(),
   onJob: (job) => {
      emitState();
      if (job.state === "failed") notice(job.message, true);
   },
   onWarning: (message, level) => (level === "log" ? void log(message) : notice(message, level === "error", "info", "app", { tone: level })),
   mediaUrl,
});
const updates = new Updates(
   () => emitState(),
   (message) => void log(message)
);
const feedback = new Feedback(
   isPackagedApp()
      ? join(process.resourcesPath, "recorder", process.platform === "win32" ? "acroclip-notifier.exe" : "acroclip-notifier")
      : resolve(here, "../../resources/recorder", process.platform === "win32" ? "acroclip-notifier.exe" : "acroclip-notifier"),
   (message) => void log(message),
   iconPath()
);
// The status bar shows low storage as a condition, so the app side stays quiet here.
const storage = new StorageMonitor({ onChange: () => emitState(), onWarning: (message) => notice(message, false, "info", "native", { tone: "warning" }) });
const recorder = new Recorder({
   gameCatalogPath: join(app.getPath("userData"), "game-catalog.json"),
   onAudioMonitorError: (monitorError, listeningError) =>
      send({ type: "audio-monitor", monitorError, ...(listeningError !== undefined ? { listeningError } : {}) }),
   onAudioLevels: (levels) => {
      if (mainWindow?.isVisible() && !mainWindow.isMinimized())
         send({
            type: "audio-levels",
            levels: {
               capture: levels.capture * 100,
               microphone: levels.microphone * 100,
               ...(levels.additional ? { additional: Object.fromEntries(Object.entries(levels.additional).map(([id, level]) => [id, level * 100])) } : {}),
            },
         });
   },
   nativePath: isPackagedApp()
      ? join(process.resourcesPath, "recorder", process.platform === "win32" ? "acroclip-recorder.exe" : "acroclip-recorder")
      : resolve(here, "../../resources/recorder", process.platform === "win32" ? "acroclip-recorder.exe" : "acroclip-recorder"),
   onState: (current) => {
      const footage = bufferedCaptureSource(current);
      if (current.state === "recording") lastRecordingArtwork = recordingArtwork(footage, captureSources.cached, lastRecordingArtwork);
      updateStorageActivity();
      send({ type: "recorder", recorder: recorderState() });
      updateTray();
   },
   onError: (message) => notice(message, true),
   onSaved: async (path, source, _requestId, capture) => {
      const clip = await collections.registerRecording(path, source, capture.application);
      emitState();
      notice(capture.previousFootage ? "Saved the footage that was still available" : "Clip saved", false, "saved", "native");
      if (preferences.autoShare && shareableTargetAllowed(clip.size, preferences.shareSizeMB)) {
         void collections.createShareable(clip.id, preferences.shareSizeMB).catch((e) => notice(errorMessage(e), true));
      }
   },
});
const captureSources = new CaptureSources(
   recorder,
   () => mainWindow?.getMediaSourceId().split(":")[1] ?? "",
   (sources) => {
      send({ type: "capture-sources", sources });
      void collections
         .enrichApplications(
            sources
               .filter((source) => source.applicationId)
               .map((source) => ({
                  id: source.applicationId!,
                  icon: source.appIcon ?? "",
                  ...(source.applicationName ? { name: source.applicationName } : {}),
               }))
         )
         .catch(() => undefined);
   }
);
function errorMessage(error: unknown): string {
   return typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Something went wrong. Try again.";
}
function recorderState(): RecorderState {
   const current = recorder.status;
   return startingCapture && current.state === "stopped" ? { ...current, state: "starting", message: "Starting capture" } : current;
}
function state(): AppState {
   return {
      windowVisible: !!mainWindow?.isVisible() && !mainWindow.isMinimized(),
      storageWarning: storage.warning,
      preferences,
      clips: collections.clips,
      collectionStatus: {
         root: collections.root,
         phase: collections.phase,
         ...(collections.scanError ? { error: collections.scanError } : {}),
         ...(collections.discovery ? { discovery: collections.discovery } : {}),
      },
      folders: collections.folders,
      applicationIcons: collections.applicationIcons,
      categories: collections.categories,
      jobs: collections.jobs,
      recorder: recorderState(),
      update: updates.state,
      version: app.getVersion(),
      platform: process.platform,
   };
}
function send(event: AppEvent) {
   if (!mainWindow || mainWindow.isDestroyed()) return;
   if (event.type !== "visibility" && (!mainWindow.isVisible() || mainWindow.isMinimized())) return;
   mainWindow.webContents.send("app-event", event);
}
function emitState() {
   if (preferences) {
      updateStorageActivity();
      // Do not advance the baseline while the renderer cannot receive updates.
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
      const event = stateChanges.event(state());
      if (event) send(event);
   }
}
function updateStorageActivity() {
   storage.setActivity(
      collections.root,
      ["starting", "recording", "waiting"].includes(recorder.status.state) || recorder.status.pendingSaves > 0 || pendingJobs().length > 0
   );
}
function mediaUrl(path: string): string {
   const full = resolve(path);
   let id = mediaKeys.get(full);
   if (!id) {
      id = randomUUID();
      mediaKeys.set(full, id);
      mediaFiles.set(id, full);
   }
   return `acroclip-media://local/${id}`;
}
async function log(message: string) {
   try {
      const directory = join(app.getPath("userData"), "logs");
      await mkdir(directory, { recursive: true });
      const file = join(directory, "app.log");
      if (((await stat(file).catch(() => null))?.size ?? 0) > 2 * 1024 * 1024) {
         await rm(`${file}.previous`, { force: true });
         await renameFile(file, `${file}.previous`);
      }
      await appendFile(file, `${new Date().toISOString()} ${message}\n`);
   } catch {
      /* Diagnostics must not break capture. */
   }
}
/**
 * Where a notice goes.
 * - `action`: answers something done in the window. In-app toast, no banner.
 * - `background`: happens while the user may be in a game. Desktop banner;
 *   errors and warnings also wait in the app as a quiet chip, and toast there
 *   instead when banners are off.
 * - `native`: desktop banner only, like clip saving.
 * - `app`: in-app only, toasting while the window has focus.
 */
type NoticeSurface = "action" | "background" | "native" | "app";
function notice(
   message: string,
   error = false,
   kind: "info" | "saving" | "saved" = "info",
   surface: NoticeSurface = "background",
   options: NoticeOptions = {}
) {
   const banner = (surface === "background" || surface === "native") && preferences?.notifications !== "off";
   const serious = error || options.tone === "warning";
   const focused = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
   if (surface === "action") send({ type: "notice", message, error, chip: error, ...options });
   else if (surface === "app" || (surface === "background" && serious))
      send({ type: "notice", message, error, chip: serious, ...options, toast: surface === "app" ? focused : !banner });
   void log(message);
   if (!banner) return;
   if (preferences?.sound && (error || kind === "saved")) shell.beep();
   void showFeedback(message, error, kind === "saving").catch(() => undefined);
}
async function showFeedback(message: string, error: boolean, saving: boolean) {
   if (preferences.notifications === "outside-fullscreen" && (await recorder.foregroundFullscreen())) return;
   feedback.show(message, error, saving);
}
let lastRecordingArtwork: RecordingArtwork | undefined;
function createWindow() {
   stateChanges.reset();
   const workArea = process.platform === "linux" ? screen.getPrimaryDisplay().workAreaSize : { width: 1380, height: 900 };
   mainWindow = new BrowserWindow({
      width: Math.min(1380, workArea.width),
      height: Math.min(900, workArea.height),
      minWidth: Math.min(980, workArea.width),
      minHeight: Math.min(680, workArea.height),
      backgroundColor: "#0d0c0f",
      frame: process.platform !== "win32",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      title: "AcroClip",
      icon: iconPath(),
      show: false,
      webPreferences: { preload: join(here, "../preload/index.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
   });
   if (process.platform === "linux") mainWindow.removeMenu();
   if (!isPackagedApp()) {
      const contents = mainWindow.webContents;
      contents.on("before-input-event", (event, input) => {
         const inspectShortcut =
            input.key === "F12" ||
            (input.key.toLowerCase() === "i" && (process.platform === "darwin" ? input.meta && input.alt : input.control && input.shift));
         if (input.type !== "keyDown" || input.isAutoRepeat || !inspectShortcut) return;
         event.preventDefault();
         contents.toggleDevTools();
      });
   }
   if (process.platform === "win32") {
      mainWindow.setAppDetails({ appId: windowsAppId(), appIconPath: process.execPath, appIconIndex: 0 });
   }
   mainWindow.once("ready-to-show", () => mainWindow?.show());
   mainWindow.webContents.on("did-start-loading", () => stateChanges.reset());
   const visibilityChanged = () => {
      const visible = !!mainWindow?.isVisible() && !mainWindow.isMinimized();
      if (!visible) {
         suspendShortcuts(false);
         previewSourceId = null;
         void recorder.monitorAudio(null).catch(() => undefined);
         void recorder.listenAudio(null).catch(() => undefined);
      }
      send({ type: "visibility", visible });
      if (visible) emitState();
   };
   mainWindow.on("show", visibilityChanged);
   mainWindow.on("hide", visibilityChanged);
   mainWindow.on("minimize", visibilityChanged);
   mainWindow.on("restore", visibilityChanged);
   mainWindow.on("close", (event) => {
      if (!quitting) {
         event.preventDefault();
         if (process.platform === "linux") void requestExit();
         else mainWindow?.hide();
      }
   });
   mainWindow.webContents.on("render-process-gone", () => {
      playbackRequest?.controller.abort();
      suspendShortcuts(false);
      void recorder.listenAudio(null).catch(() => undefined);
   });
   mainWindow.webContents.on("did-start-navigation", (navigation) => {
      if (navigation.isMainFrame) {
         // In-app history updates keep the current renderer and its playback request.
         if (!navigation.isSameDocument) playbackRequest?.controller.abort();
         suspendShortcuts(false);
         void recorder.listenAudio(null).catch(() => undefined);
      }
   });
   mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   mainWindow.webContents.on("will-navigate", (event, url) => {
      if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
   });
   const dev = process.env["ELECTRON_RENDERER_URL"];
   if (dev) void mainWindow.loadURL(dev);
   else void mainWindow.loadFile(join(here, "../renderer/index.html"));
}
function iconPath() {
   const file = process.platform === "win32" ? "icon.ico" : "icon.png";
   return isPackagedApp() ? join(process.resourcesPath, "icons", file) : resolve(here, "../../build", file);
}
function trayIcon() {
   const path = isPackagedApp() ? join(process.resourcesPath, "icons/icon.png") : resolve(here, "../../build/icon.png");
   const image = nativeImage.createFromPath(path);
   if (image.isEmpty()) throw new Error("AcroClip's app icon is missing. Rebuild the app icons.");
   return image.resize({ width: 20, height: 20 });
}
function updateTray() {
   if (!tray) return;
   const active = recorder.status.state === "recording" || recorder.status.state === "waiting";
   renderTray(tray, recorder.status, !!startingCapture, {
      open: () => {
         mainWindow?.show();
         mainWindow?.focus();
      },
      toggleRecording: () => void (active ? recorder.stop() : startRecording()).catch((e) => notice(errorMessage(e), true)),
      saveClip: () => void saveClip().catch((e) => notice(errorMessage(e), true)),
      exit: () => void requestExit(),
   });
}
async function ensureMicrophoneAccess(value: Preferences): Promise<void> {
   if (process.platform === "darwin" && needsMicrophonePermission(value) && systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
      if (!(await systemPreferences.askForMediaAccess("microphone")))
         throw new Error("Allow microphone access in System Settings, or mute microphone sources.");
   }
}
async function startRecording() {
   lastRecordingArtwork = undefined;
   if (!preferences.setupComplete) throw new Error("Finish setup before capturing.");
   if (closingRequested) throw new Error("AcroClip is preparing to exit. Keep the app open to record.");
   if (startingCapture || ["starting", "recording", "waiting"].includes(recorder.status.state)) throw new Error("Capture is already running.");
   startingCapture = (async () => {
      await preferenceWrites.catch(() => undefined);
      await ensureMicrophoneAccess(preferences);
      const available = await captureSources.list();
      if (closingRequested) throw new Error("AcroClip is preparing to exit. Keep the app open to record.");
      await recorder.start(preferences, available);
   })();
   emitState();
   updateTray();
   try {
      await startingCapture;
   } finally {
      startingCapture = null;
      emitState();
      updateTray();
   }
}
async function saveClip() {
   const requestedAt = Date.now();
   if (closingRequested) throw new Error("AcroClip is preparing to exit. Keep the app open to save another clip.");
   if (recorder.status.state !== "recording" && recorder.status.state !== "waiting") throw new Error("Start capturing before saving a clip.");
   if (!collections.root) throw new Error("The collection folder is still opening. Try saving again when it is available.");
   send({ type: "clip-action" });
   const footage = bufferedCaptureSource(recorder.status);
   await collections.finishFileChanges();
   lastRecordingArtwork = recordingArtwork(footage, captureSources.cached, lastRecordingArtwork);
   const applicationName =
      lastRecordingArtwork?.application.name ??
      normalizeApplicationLabel(footage.name || (preferences.sourceKind === "auto" ? "Game" : recordingSourceLabel(preferences, captureSources.cached)));
   const destination = recordingDestination(
      { ...preferences, collection: collections.root },
      applicationName,
      new Date(requestedAt),
      recorder.pendingSavePaths
   );
   mkdirSync(dirname(destination), { recursive: true });
   if (!withinRoot(collections.root, realpathSync(dirname(destination))))
      throw new Error("The capture folder points outside this collection. Choose another folder.");
   void storage.check(collections.root);
   await recorder.save(destination, requestedAt, lastRecordingArtwork?.application);
   // The status bar shows saves in progress, so this only reaches the desktop banner.
   notice("Saving clip…", false, "saving", "native");
}
function pendingJobs() {
   return collections.pendingJobs;
}
async function applyStartup(enabled: boolean) {
   if (process.env["ACROCLIP_TEST"] === "1") return;
   const executable = process.env["PORTABLE_EXECUTABLE_FILE"] ?? process.env["APPIMAGE"] ?? app.getPath("exe");
   const args = isPackagedApp() ? [] : [app.getAppPath()];
   if (process.platform === "linux")
      await linuxStartup(enabled, xdgDirectory(process.env["XDG_CONFIG_HOME"], join(app.getPath("home"), ".config")), executable, args);
   else app.setLoginItemSettings({ openAtLogin: enabled, path: executable, args });
}
interface ExitOptions {
   /** The user asked to restart into an update: only destructive choices may still prompt. */
   update?: boolean;
   progress?: (message: string) => void;
}
async function prepareExit(options: ExitOptions = {}): Promise<boolean> {
   if (exiting) return exiting;
   closingRequested = true;
   const update = options.update === true;
   const started = Date.now();
   const phase = (name: string) => {
      if (update) void log(`update: exit ${name} at ${Date.now() - started} ms`);
   };
   exiting = (async () => {
      await preferenceWrites.catch(() => undefined);
      await startingCapture?.catch(() => undefined);
      await collections.finishFileChanges();
      phase("settled files");
      const saves = recorder.status.pendingSaves;
      if (update && !pendingJobs().length) {
         // Restarting into an update is already the user's answer to "exit?". Clip
         // saves finish first, so no requested moment is lost to the installer.
         if (saves) options.progress?.(`Finishing ${saves === 1 ? "clip save" : `${saves} clip saves`}`);
         await recorder.close();
         phase("closed the recorder");
      } else if (saves || pendingJobs().length) {
         const decision = await pendingExitDecision(
            () => !!recorder.status.pendingSaves || pendingJobs().length > 0,
            async (signal) =>
               (
                  await dialog.showMessageBox({
                     type: "question",
                     title: "Work is still running",
                     message: "Finish before exiting?",
                     detail: `${saves ? `${saves} clip save${saves === 1 ? "" : "s"}` : ""}${saves && pendingJobs().length ? " and " : ""}${pendingJobs().length ? `${pendingJobs().length} shareable${pendingJobs().length === 1 ? "" : "s"}` : ""} still in progress.`,
                     buttons: ["Finish and exit", "Cancel work", "Keep open"],
                     defaultId: 0,
                     cancelId: 2,
                     signal,
                  })
               ).response
         );
         if (decision === 2) return false;
         if (decision === 1) {
            if (recorder.status.pendingSaves) {
               const confirm = await dialog.showMessageBox({
                  type: "warning",
                  message: "Discard pending clips?",
                  detail: "These moments have not finished saving and may be lost.",
                  buttons: ["Keep saving", "Discard and exit"],
                  defaultId: 1,
                  cancelId: 0,
               });
               if (confirm.response !== 1) return false;
            }
            await Promise.all(pendingJobs().map((j) => collections.cancelJob(j.id)));
            await recorder.close({ cancel: true });
            while (pendingJobs().length) await new Promise((r) => setTimeout(r, 100));
         } else {
            options.progress?.("Finishing work");
            await recorder.stop();
            await recorder.close();
            while (pendingJobs().length) await new Promise((r) => setTimeout(r, 150));
         }
         phase("finished work");
      } else {
         if (["recording", "waiting"].includes(recorder.status.state)) {
            const result = await dialog.showMessageBox({
               type: "question",
               message: "Stop capturing and exit?",
               detail: "Unsaved recent footage will be cleared.",
               buttons: ["Exit", "Keep capturing"],
               defaultId: 0,
               cancelId: 1,
            });
            if (result.response !== 0) return false;
         }
         await recorder.close();
      }
      return true;
   })();
   try {
      return await exiting;
   } finally {
      exiting = null;
      if (!quitting) closingRequested = false;
   }
}
async function prepareUpdateExit(progress: (message: string) => void): Promise<boolean> {
   // The window goes away at once so the click feels immediate. Shareables still
   // ask first, because finishing or cancelling them is the user's decision.
   if (!pendingJobs().length) mainWindow?.hide();
   if (!(await prepareExit({ update: true, progress }))) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      return false;
   }
   // before-quit must not run the exit flow again while the installer waits for this process.
   quitting = true;
   closingRequested = true;
   return true;
}
function recoverUpdateExit() {
   quitting = false;
   closingRequested = false;
   if (!mainWindow || mainWindow.isDestroyed()) createWindow();
   else mainWindow.show();
   if (preferences.autoRecord && preferences.setupComplete && process.env["ACROCLIP_TEST"] !== "1")
      void startRecording().catch((e) => notice(errorMessage(e), true));
}
async function requestExit() {
   try {
      if (await prepareExit()) {
         quitting = true;
         storage.close();
         feedback.close();
         globalShortcut.unregisterAll();
         app.quit();
      }
   } catch (error) {
      notice(`AcroClip could not finish exiting: ${errorMessage(error)}`, true);
   }
}
function trustedPath(path: unknown): string {
   const candidate = z.string().max(4096).parse(path);
   const full = resolve(candidate);
   const known = [collections.root, ...collections.clips.flatMap((c) => [c.path, ...c.shareables.map((s) => s.path)])].some((p) => samePath(resolve(p), full));
   if (!known) throw new Error("This file is not part of the open collection.");
   const actual = realpathSync(full);
   if (!withinRoot(collections.root, actual)) throw new Error("This file moved outside the collection.");
   return actual;
}
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
   ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (event.sender !== mainWindow?.webContents) throw new Error("Unknown window");
      try {
         if (
            ![
               "state",
               "sources",
               "choose-folder",
               "update-check",
               "update-download",
               "update-release",
               "update-reveal",
               "exit",
               "preferences",
               "playback",
               "cancel-playback",
               "record-start",
               "record-stop",
               "record-save",
               "recording-capabilities",
               "capture-shortcut",
               "preview-source",
               "monitor-audio",
               "listen-audio",
               "audio-devices",
               "games",
               "game-catalog",
            ].includes(channel)
         )
            await collectionReady;
         if (
            closingRequested &&
            [
               "preferences",
               "share",
               "rename",
               "delete",
               "category",
               "record-start",
               "record-save",
               "folder-create",
               "folder-rename",
               "folder-move",
               "folder-delete",
               "clip-move",
            ].includes(channel)
         )
            throw new Error("AcroClip is preparing to exit. Keep the app open to make changes.");
         return await fn(...args);
      } catch (e) {
         // Playback and preview report errors locally and discard obsolete requests.
         // A global notice would outlive a source or file switch.
         if (!["playback", "cancel-playback", "preview-source", "monitor-audio", "listen-audio", "preferences"].includes(channel))
            notice(errorMessage(e), true, "info", "action");
         else void log(`${channel}: ${errorMessage(e)}`);
         throw e;
      }
   });
}
let hotkeysSuspended = false;
const installedShortcuts = new Map<ShortcutAction, string>();
function globalAction(id: ShortcutAction): void {
   const active = ["recording", "waiting"].includes(recorder.status.state);
   const operation =
      id === "saveClip"
         ? saveClip()
         : id === "stopRecording" || (id === "toggleRecording" && active)
           ? recorder.stop()
           : active || startingCapture
             ? Promise.resolve()
             : startRecording();
   void operation.catch((error: unknown) => notice(errorMessage(error), true));
}
function suspendShortcuts(enabled: boolean): void {
   if (hotkeysSuspended === enabled) return;
   hotkeysSuspended = enabled;
   for (const [id, key] of installedShortcuts) {
      if (enabled) globalShortcut.unregister(key);
      else if (!globalShortcut.register(key, () => globalAction(id)))
         notice(`${shortcutRegistry.find((item) => item.id === id)!.label} shortcut is unavailable. Choose another in Settings.`, true, "info", "action");
   }
}
function installShortcuts(next: Preferences, startup = false): () => void {
   const desired = new Map(
      shortcutRegistry
         .filter((item) => item.scope === "global")
         .map((item) => [item.id, bindingFor(next, item.id)] as const)
         .filter(([, key]) => key)
   );
   if (JSON.stringify([...desired]) === JSON.stringify([...installedShortcuts])) return () => {};
   const previous = new Map(installedShortcuts);
   const clear = () => {
      for (const key of installedShortcuts.values()) globalShortcut.unregister(key);
      installedShortcuts.clear();
   };
   const restore = () => {
      clear();
      for (const [id, key] of previous) if (globalShortcut.register(key, () => globalAction(id))) installedShortcuts.set(id, key);
   };
   clear();
   for (const [id, key] of desired) {
      if (globalShortcut.register(key, () => globalAction(id))) installedShortcuts.set(id, key);
      else if (startup) notice(`${shortcutRegistry.find((item) => item.id === id)!.label} shortcut is unavailable. Choose another in Settings.`, true);
      else {
         restore();
         throw new Error(`${shortcutRegistry.find((item) => item.id === id)!.label} shortcut isn't available. Choose another key combination.`);
      }
   }
   return restore;
}
function registerIPC() {
   handle("capture-shortcut", (enabled) => suspendShortcuts(z.boolean().parse(enabled) && !!mainWindow?.isVisible() && !mainWindow.isMinimized()));
   handle("recording-capabilities", () => recorder.capabilities());
   handle("state", () => state());
   handle("sources", (options) =>
      captureSources.list(z.object({ thumbnails: z.boolean().optional() }).strict().optional().parse(options)?.thumbnails ?? false)
   );
   handle("games", () => recorder.games(preferences.customGames));
   handle("game-catalog", () => recorder.gameCatalog());
   handle("preview-source", async (id, token) => {
      const owner = z.string().max(100).optional().parse(token);
      const requested = z.string().max(200).nullable().parse(id);
      if (requested === null) {
         if (owner && owner !== previewOwner) return;
         previewOwner = null;
         previewSourceId = null;
         return;
      }
      if (requested === portalScreenId) throw new Error("System-selected capture does not provide a separate live preview.");
      if (process.platform === "linux" && (await recorder.capabilities()).captureBackend === "wayland-portal")
         throw new Error("Live preview is unavailable in this Wayland session. Capture uses the selected application directly.");
      if (!mainWindow?.isVisible() || mainWindow.isMinimized() || !preferences.setupComplete) throw new Error("Open Capture to preview the capture source.");
      const selected = previewCaptureSource(captureSources.cached, preferences, recorder.status);
      if (!selected || selected.id !== requested) throw new Error("The selected preview source is unavailable.");
      previewSourceId = requested;
      previewOwner = owner ?? null;
   });
   handle("listen-audio", async (source) => {
      const id = z.string().max(200).nullable().parse(source);
      if (id && (!mainWindow?.isVisible() || mainWindow.isMinimized() || !preferences.setupComplete)) throw new Error("Open Capture to listen.");
      if (id && !["starting", "recording", "waiting"].includes(recorder.status.state)) await recorder.monitorAudio(preferences);
      return recorder.listenAudio(id);
   });
   handle("monitor-audio", (enabled) =>
      recorder.monitorAudio(
         z.boolean().parse(enabled) && preferences.setupComplete && mainWindow?.isVisible() && !mainWindow.isMinimized()
            ? monitoringPreferences(preferences, preferences.sourceKind === "auto" || !!selectedCaptureSource(captureSources.cached, preferences))
            : null
      )
   );
   handle("audio-devices", (kind) => recorder.audioDevices(z.enum(["input", "output"]).default("input").parse(kind)));
   handle("choose-folder", async () => {
      const picked = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], defaultPath: preferences.collection });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
   });
   handle("preferences", async (value, changedKeys) => {
      const operation = preferenceWrites
         .catch(() => undefined)
         .then(async () => {
            if (startingCapture) throw new Error("Capture is starting. Wait before applying settings.");
            const next = synchronizeLegacyAudio(preferences, mergePreferenceChanges(preferences, value, changedKeys));
            if (audioTopology(next) !== audioTopology(preferences) || next.sourceKind !== preferences.sourceKind || next.sourceId !== preferences.sourceId)
               assertDistinctAudioSources(next, captureSources.cached);
            if (!next.collection.trim()) throw new Error("Choose a collection folder.");
            if (!isValidShortcut(next.shortcut)) throw new Error("That key combination is not supported. Try a letter, number, or function key.");
            if (recorder.status.state !== "stopped" && recorder.status.state !== "error" && requiresCaptureRestart(preferences, next))
               throw new Error("Stop capturing to apply these changes. Footage you haven't saved will be discarded.");
            if (next.collection !== preferences.collection && (recorder.status.state !== "stopped" || recorder.status.pendingSaves || pendingJobs().length))
               throw new Error("Stop capturing and finish shareables before changing the collection folder.");
            const conflict = shortcutConflict(next, process.platform === "darwin");
            if (conflict) throw new Error(conflict);
            for (const item of shortcutRegistry) {
               const key = bindingFor(next, item.id);
               if (key && !isValidShortcut(key)) throw new Error(`Choose a valid shortcut for ${item.label}.`);
            }
            const rollbackShortcuts = installShortcuts(next);
            try {
               if (needsMicrophonePermission(next) && !needsMicrophonePermission(preferences)) await ensureMicrophoneAccess(next);
               if (next.collection !== preferences.collection) await collections.open(next.collection);
               if (
                  ["recording", "waiting"].includes(recorder.status.state) &&
                  (next.sourceId !== preferences.sourceId ||
                     next.sourceKind !== preferences.sourceKind ||
                     next.desktopFallback !== preferences.desktopFallback ||
                     JSON.stringify(next.customGames) !== JSON.stringify(preferences.customGames))
               )
                  await recorder.switchSource(next, await captureSources.list());
               if (next.startWithOS !== preferences.startWithOS) await applyStartup(next.startWithOS);
               if (["recording", "waiting"].includes(recorder.status.state)) {
                  for (const source of next.audioSources.filter((source) => source.enabled))
                     await recorder.setAudio({ source: source.id, volume: source.volume, muted: source.muted });
               }
               await writePreferences(preferencePath, next);
            } catch (e) {
               rollbackShortcuts();
               if (next.collection !== preferences.collection && collections.root !== resolve(preferences.collection))
                  await collections.open(preferences.collection).catch((error: unknown) => notice(errorMessage(error), true, "info", "action"));
               if (
                  ["recording", "waiting"].includes(recorder.status.state) &&
                  (next.sourceId !== preferences.sourceId ||
                     next.sourceKind !== preferences.sourceKind ||
                     next.desktopFallback !== preferences.desktopFallback ||
                     JSON.stringify(next.customGames) !== JSON.stringify(preferences.customGames))
               )
                  await recorder
                     .switchSource(preferences, captureSources.cached)
                     .catch((error: unknown) => notice(errorMessage(error), true, "info", "action"));
               if (next.startWithOS !== preferences.startWithOS)
                  await applyStartup(preferences.startWithOS).catch((error: unknown) => notice(errorMessage(error), true, "info", "action"));
               if (["recording", "waiting"].includes(recorder.status.state)) {
                  for (const source of preferences.audioSources.filter((source) => source.enabled))
                     await recorder.setAudio({ source: source.id, volume: source.volume, muted: source.muted }).catch(() => undefined);
               }
               throw e;
            }
            if (next.sourceId !== preferences.sourceId || next.sourceKind !== preferences.sourceKind) previewSourceId = null;
            preferences = next;
            recorder.updatePreferences(next);
            emitState();
            return state();
         });
      preferenceWrites = operation;
      return operation;
   });
   handle("record-start", () => startRecording());
   handle("record-stop", async () => {
      await startingCapture?.catch(() => undefined);
      await recorder.stop();
   });
   handle("record-save", () => saveClip());
   handle("share", (id, target) => {
      const clipId = idSchema.parse(id);
      const targetMB = target === undefined ? preferences.shareSizeMB : z.number().min(1).max(2000).parse(target);
      const clip = collections.clips.find((item) => item.id === clipId);
      if (!clip) throw new Error("This clip is no longer in the collection.");
      if (!shareableTargetAllowed(clip.size, targetMB)) throw new Error("Choose a shareable size target no larger than the clip.");
      return collections.createShareable(clipId, targetMB);
   });
   handle("cancel-job", (id) => collections.cancelJob(idSchema.parse(id)));
   handle("rename", (id, name) => collections.rename(idSchema.parse(id), z.string().trim().min(1).max(150).parse(name)));
   const folderPathSchema = z.string().max(4096);
   const folderChangesAvailable = () => {
      if (recorder.status.pendingSaves) throw new Error("Wait for clips to finish saving before changing folders.");
   };
   handle("folder-create", (parent, name) => collections.createFolder(folderPathSchema.parse(parent), z.string().max(150).parse(name)));
   handle("folder-rename", (path, name) => {
      folderChangesAvailable();
      return collections.renameFolder(folderPathSchema.parse(path), z.string().max(150).parse(name));
   });
   handle("folder-move", async (path, destination) => {
      folderChangesAvailable();
      const selected = folderPathSchema.parse(path);
      const target = folderPathSchema.parse(destination);
      const contents = await collections.inspectFolder(selected);
      const result = await dialog.showMessageBox({
         type: "question",
         message: `Move "${selected.split(/[\\/]/).at(-1)}" to "${target || "Collection"}"?`,
         detail: `${contents.clips} ${contents.clips === 1 ? "clip" : "clips"}, ${contents.otherFiles} other ${contents.otherFiles === 1 ? "file" : "files"}, ${contents.folders} ${contents.folders === 1 ? "subfolder" : "subfolders"}. All contents will move.`,
         buttons: ["Cancel", "Move folder"],
         defaultId: 1,
         cancelId: 0,
      });
      if (result.response !== 1) return null;
      folderChangesAvailable();
      return collections.moveFolder(selected, target, contents.fingerprint);
   });
   handle("clip-move", (id, destination) => collections.moveClip(idSchema.parse(id), folderPathSchema.parse(destination)));
   handle("folder-delete", async (path) => {
      folderChangesAvailable();
      const selected = folderPathSchema.parse(path);
      const contents = await collections.inspectFolder(selected);
      const result = await dialog.showMessageBox({
         type: "warning",
         message: `Move "${selected.split(/[\\/]/).at(-1)}" and all its contents to the trash?`,
         detail: `${contents.clips} ${contents.clips === 1 ? "clip" : "clips"}, ${contents.otherFiles} other ${contents.otherFiles === 1 ? "file" : "files"}, ${contents.folders} ${contents.folders === 1 ? "subfolder" : "subfolders"}.`,
         buttons: ["Cancel", "Move to trash"],
         defaultId: 0,
         cancelId: 0,
      });
      if (result.response !== 1) return false;
      folderChangesAvailable();
      await collections.trashFolder(selected, contents.fingerprint, (directory) => shell.trashItem(directory));
      return true;
   });
   handle("delete", async (id, shareId, scope) => {
      const clipId = idSchema.parse(id);
      const shareableId = shareId === undefined ? undefined : idSchema.parse(shareId);
      const selection = scope === undefined ? undefined : z.literal("shareables").parse(scope);
      if (pendingJobs().some((j) => j.clipId === clipId)) throw new Error("Cancel the shareable export before removing this clip.");
      const result = await dialog.showMessageBox({
         type: "warning",
         message: shareableId
            ? "Move this shareable to the trash?"
            : selection === "shareables"
              ? "Move all shareables for this clip to the trash?"
              : "Move this clip and its shareables to the trash?",
         buttons: ["Cancel", "Move to trash"],
         defaultId: 0,
         cancelId: 0,
      });
      if (result.response !== 1) return;
      const deleted: string[] = [];
      try {
         for (const path of await collections.filesForDeletion(clipId, shareableId, selection)) {
            await shell.trashItem(path);
            deleted.push(path);
         }
      } finally {
         await collections.removeDeleted(clipId, deleted);
      }
   });
   handle("category-reorder", (id, beforeId) => collections.reorderCategory(idSchema.parse(id), idSchema.nullable().parse(beforeId)));
   handle("category", async (action, value) => {
      const request = categoryRequest.parse(value);
      switch (z.enum(["create", "update", "delete", "assign", "toggle"]).parse(action)) {
         case "create":
            return collections.createCategory(request.name ?? "New tag", request.color ?? "#b197fc", request.icon ?? "tag");
         case "update":
            return collections.updateCategory(idSchema.parse(request.id), request.name ?? "", request.color ?? "#b197fc", request.icon ?? "tag");
         case "delete":
            return collections.deleteCategory(idSchema.parse(request.id));
         case "assign":
            return collections.assignCategories(idSchema.parse(request.clipId), request.categoryIds ?? []);
         case "toggle":
            return collections.toggleCategory(idSchema.parse(request.clipId), idSchema.parse(request.id));
      }
   });
   handle("reveal", (path) => {
      const selected = trustedPath(path);
      if (samePath(selected, collections.root)) void shell.openPath(selected);
      else shell.showItemInFolder(selected);
   });
   const detectAttaCut = () =>
      findAttaCut(join(app.getPath("userData"), "attacut.json"), {
         platform: process.platform,
         home: app.getPath("home"),
         appData: app.getPath("appData"),
         searchPath: process.env["PATH"] ?? "",
         programFiles: [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter((directory): directory is string => !!directory),
      });
   handle("attacut-available", async () => !!(await detectAttaCut()));
   handle("attacut", async (id) => {
      const clip = collections.clips.find((c) => c.id === idSchema.parse(id));
      if (!clip || clip.originalMissing) throw new Error("This clip is no longer in the collection.");
      const executable = await detectAttaCut();
      if (!executable) throw new Error("AttaCut is no longer available. Install it to open this clip there.");
      const { spawn } = await import("node:child_process");
      const child = spawn(executable, [clip.path], { detached: true, stdio: "ignore", windowsHide: true, env: attaCutEnvironment(process.env) });
      child.once("error", () => notice("AttaCut couldn't open. Show the clip in your file manager and open it from there.", true, "info", "action"));
      child.unref();
   });
   handle("playback", async (path, track, requestId) => {
      const source = trustedPath(path);
      const selection =
         track === undefined ? undefined : z.union([z.number().int().min(0).max(63), z.array(z.number().int().min(0).max(63)).min(1).max(64)]).parse(track);
      if (requestId === undefined) return collections.playback(source, selection);
      const id = z.string().uuid().parse(requestId);
      playbackRequest?.controller.abort();
      const request = { id, controller: new AbortController() };
      playbackRequest = request;
      try {
         return await collections.playback(source, selection, request.controller.signal);
      } finally {
         if (playbackRequest === request) playbackRequest = undefined;
      }
   });
   handle("cancel-playback", (requestId) => {
      if (playbackRequest?.id === z.string().uuid().parse(requestId)) playbackRequest.controller.abort();
   });
   handle("refresh", async () => {
      await collections.refresh();
   });
   handle("update-check", () => updates.check());
   handle("update-download", () => updates.download());
   handle("update-reveal", () => updates.reveal());
   handle("update-release", () => updates.release());
   handle("update-install", () => updates.install({ prepare: prepareUpdateExit, recover: recoverUpdateExit }));
   handle("exit", () => requestExit());
   ipcMain.on("window", (event, action) => {
      if (event.sender !== mainWindow?.webContents) return;
      switch (action) {
         case "minimize":
            mainWindow.minimize();
            break;
         case "maximize":
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
            break;
         case "close":
            mainWindow.close();
            break;
      }
   });
   ipcMain.on("drag", (event, path) => {
      if (event.sender !== mainWindow?.webContents) return;
      try {
         event.sender.startDrag({ file: trustedPath(path), icon: trayIcon() });
      } catch (e) {
         notice(errorMessage(e), true, "info", "action");
      }
   });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
   app.on("second-instance", (_event, arguments_) => {
      if (closingRequested || quitting) return;
      if (arguments_.includes("--clip")) {
         void saveClip().catch((error: unknown) => notice(errorMessage(error), true));
         return;
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
         if (app.isReady()) createWindow();
         return;
      }
      mainWindow.show();
      mainWindow.focus();
   });
   app.on("before-quit", (event) => {
      if (!quitting) {
         event.preventDefault();
         void requestExit();
      } else {
         storage.close();
         feedback.close();
         globalShortcut.unregisterAll();
      }
   });
   app.on("window-all-closed", () => {
      /* The recorder and tray own the app lifecycle. */
   });
   app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else mainWindow.show();
   });
   void app
      .whenReady()
      .then(async () => {
         registerWindowsIdentity(process.execPath);
         if (process.platform === "darwin") app.dock?.setIcon(iconPath());
         preferencePath = join(app.getPath("userData"), "preferences.json");
         preferences = await readPreferences(preferencePath, process.env["ACROCLIP_COLLECTION"] ?? join(app.getPath("videos"), "AcroClip"));
         collectionReady = collections.open(preferences.collection);
         const previewAllowed = () => !!previewSourceId && !!mainWindow?.isVisible() && !mainWindow.isMinimized() && !closingRequested && !isWaylandSession();
         session.defaultSession.setDisplayMediaRequestHandler(
            (request, callback) => {
               if (request.frame !== mainWindow?.webContents.mainFrame || !request.videoRequested || request.audioRequested || !previewAllowed()) {
                  callback(null);
                  return;
               }
               const requested = previewSourceId;
               const owner = previewOwner;
               const sourceKind = preferences.sourceKind;
               const sourceId = preferences.sourceId;
               void captureSources
                  .preview(requested!)
                  .then((available) => {
                     if (
                        !previewAllowed() ||
                        previewSourceId !== requested ||
                        previewOwner !== owner ||
                        preferences.sourceKind !== sourceKind ||
                        preferences.sourceId !== sourceId ||
                        (sourceKind === "auto" &&
                           (!["recording", "waiting"].includes(recorder.status.state) ||
                              (recorder.status.sourceKind === "screen" && !preferences.desktopFallback) ||
                              (recorder.status.sourceId !== requested &&
                                 !(requested?.startsWith("window:") && requested.split(":")[1] === recorder.status.sourceId?.split(":")[1]))))
                     ) {
                        callback(null);
                        return;
                     }
                     const selected = available.find((source) => source.id === requested);
                     callback(selected ? { video: selected } : null);
                  })
                  .catch((error: unknown) => {
                     void log(`Preview source failed: ${errorMessage(error)}`);
                     callback(null);
                  });
            },
            { useSystemPicker: false }
         );
         session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
            callback(
               webContents === mainWindow?.webContents &&
                  ((permission === "fullscreen" && details.isMainFrame && !!mainWindow?.isVisible()) ||
                     (permission === "display-capture" && previewAllowed()) ||
                     (permission === "media" && details.isMainFrame && "mediaTypes" in details && details.mediaTypes?.length === 0 && previewAllowed()) ||
                     (permission === "media" && "mediaTypes" in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === "audio"))
            )
         );
         session.defaultSession.setPermissionCheckHandler(
            (webContents, permission, _origin, details) =>
               webContents === mainWindow?.webContents &&
               ((permission === "fullscreen" && details.isMainFrame && !!mainWindow?.isVisible()) ||
                  (permission === "display-capture" && details.isMainFrame && previewAllowed()) ||
                  (permission === "media" && details.mediaType === "audio"))
         );
         protocol.handle("acroclip-media", async (request) => {
            const url = new URL(request.url);
            const path = mediaFiles.get(url.pathname.slice(1));
            if (url.hostname !== "local" || !path) return new Response(null, { status: 403 });
            try {
               const actual = await realpath(path);
               if (!withinRoot(collections.root, actual)) return new Response(null, { status: 403 });
               return await serveMedia(actual, request);
            } catch {
               return new Response(null, { status: 404 });
            }
         });
         registerIPC();
         createWindow();
         tray = new Tray(trayIcon());
         tray.on("double-click", () => mainWindow?.show());
         updateTray();
         if (process.platform === "linux" && isPackagedApp() && process.env["ACROCLIP_TEST"] !== "1") {
            await linuxDesktopIdentity(
               xdgDirectory(process.env["XDG_DATA_HOME"], join(app.getPath("home"), ".local", "share")),
               process.env["APPIMAGE"] ?? process.execPath,
               iconPath()
            ).catch((error: unknown) => notice(errorMessage(error), true));
            // AppImage updates can replace the versioned executable path.
            if (preferences.startWithOS) await applyStartup(true).catch((error: unknown) => notice(errorMessage(error), true));
         }
         installShortcuts(preferences, true);
         if (process.argv.includes("--clip")) void saveClip().catch((error: unknown) => notice(errorMessage(error), true));
         setInterval(() => {
            emitState();
            if (!refreshBusy && !pendingJobs().length) {
               refreshBusy = true;
               void collections
                  .refresh()
                  .catch((e) => void log(errorMessage(e)))
                  .finally(() => {
                     refreshBusy = false;
                  });
            }
         }, 5000).unref();
         if (preferences.autoRecord && preferences.setupComplete && process.env["ACROCLIP_TEST"] !== "1")
            void startRecording().catch((e) => notice(errorMessage(e), true));
         await collectionReady;
         const previousInstall = await updates.reviewPreviousInstall();
         if (previousInstall) notice(previousInstall, true);
         if (isPackagedApp() && (process.env["ACROCLIP_TEST"] !== "1" || testUpdateServer())) {
            const check = () => {
               if (preferences.updateCheck) void updates.check(false);
            };
            setTimeout(check, 10000).unref();
            // A tray recorder can run for days; keep offering releases published meanwhile.
            setInterval(check, BACKGROUND_CHECK_INTERVAL).unref();
         }
      })
      .catch((e) => {
         void log(errorMessage(e));
         void dialog.showMessageBox({ type: "error", message: "AcroClip couldn't start", detail: errorMessage(e) }).then(() => {
            quitting = true;
            app.quit();
         });
      });
}
