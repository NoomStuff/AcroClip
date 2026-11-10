import { notificationDelivery, type NotificationAction } from "../shared/notifications";
import { shareableTargetAllowed } from "../shared/shareable-target";
import { normalizeApplicationLabel } from "./application-identity";
import { isPackagedApp, registerWindowsIdentity, windowsAppId } from "./identity";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, protocol, shell, Tray, session, systemPreferences, screen } from "electron";
import { mkdirSync, realpathSync } from "node:fs";
import { mkdir, realpath, rm, stat, statfs, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, homedir, release, totalmem, version as kernelVersion } from "node:os";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppEvent, AppState, ApplicationArtwork, CaptureSource, NoticeOptions, Preferences, RecorderState, RecordingCapabilities } from "../shared/types";
import { recordingArtwork, type RecordingArtwork } from "./recording-artwork";
import { categoryRequest, idSchema } from "../shared/validation";
import { assertDistinctAudioSources } from "./audio-sources";
import { audioTopology, synchronizeLegacyAudio, monitoringPreferences } from "../shared/audio-model";
import { mergePreferenceChanges, readPreferences, requiresCaptureRestart, writePreferences } from "./preferences";
import { CollectionService, withinRoot } from "./collection";
import { isValidShortcut, recordingDestination, recordingSourceLabel, samePath } from "./safety";
import { bindingFor, shortcutRegistry, shortcutConflict } from "../shared/shortcuts";
import type { ShortcutAction } from "../shared/shortcuts";
import { CaptureTimeout, Recorder } from "./recorder";
import { CaptureSources } from "./capture-sources";
import { serveMedia } from "./serve";
import { StatsLog } from "./stats";
import { viewEventSchema } from "../shared/stats";
import type { SaveTrigger, StatsAction } from "../shared/stats";
import { summarizeStats } from "../shared/stats-summary";
import { Diagnostics, homeRedactor } from "./diagnostics";
import type { LogLevel, SessionRecord } from "./diagnostics";
import { buildSystemReport } from "./system-report";
import { createZip } from "./zip";
import { bugReportUrl, describeSystem, logArchiveName, rendererErrorSchema } from "../shared/diagnostics";
import { factoryResetDetail, historyPartsSchema, preferenceResetSchema, resetPartsSchema, resetPreferenceGroups } from "../shared/maintenance";
import type { ResetPart } from "../shared/maintenance";
import { loudnessEnvelope, probe } from "./media";
import { BACKGROUND_CHECK_INTERVAL, Updates } from "./updates";
import { testUpdateServer } from "./update-manager";
import { isWaylandSession } from "./linux-session";
import { linuxDesktopIdentity, linuxStartup, linuxDesktopName, xdgDirectory } from "./startup";
import { pendingExitDecision } from "./lifecycle";
import { Feedback, type FeedbackDetails } from "./feedback";
import { captureErrorReport, feedbackRequest, routeNotice, type NoticeKind, type NoticeSurface } from "./notice-routing";
import { RecordingNotices, type RecordingNoticeKind } from "./recording-notices";
import { SaveFailure } from "./save-failure";
import { bufferedCaptureSource, portalScreenId, selectedCaptureSource, previewCaptureSource } from "../shared/capture-policy";
import { attaCutEnvironment, findAttaCut } from "./attacut";
import { needsMicrophonePermission } from "../shared/audio-policy";
import { StorageMonitor } from "./storage";
import { StateChanges } from "./state-changes";
import { updateTray as renderTray } from "./tray";
import { CollectionRefresh } from "./collection-refresh";
import { footageWindow, mergeCandidate } from "./merge-policy";
import type { SavedFootage } from "./merge-policy";
import { saveOutcomeNotice } from "../shared/save-outcome";
import type { SaveOutcome } from "../shared/save-outcome";
import { copyFileToClipboard } from "./clipboard-file";

// CORS lets the renderer read back images it asks for with crossOrigin, such as hover strips it
// compares with their thumbnail. Requests without it, like playback, are unchanged.
protocol.registerSchemesAsPrivileged([
   { scheme: "acroclip-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);
// The player switches and mixes a clip's audio tracks in place, instead of preparing a copy per selection.
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");
const here = dirname(fileURLToPath(import.meta.url));
const testProfile = process.env["ACROCLIP_PROFILE"];
if (testProfile) app.setPath("userData", resolve(testProfile));
app.setName("AcroClip");
const appStartedAt = Date.now();
const diagnostics = new Diagnostics({ directory: join(app.getPath("userData"), "logs"), version: app.getVersion() });
// Observes without replacing Electron's own handling, which shows the error and may exit.
process.on("uncaughtExceptionMonitor", (error, origin) =>
   diagnostics.crashed(`${origin}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
);
// Electron only warns about these in the main process; keep them in the log instead.
process.on("unhandledRejection", (reason) =>
   log(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`, "error")
);
if (process.platform === "linux") app.setDesktopName(linuxDesktopName);
if (process.platform === "win32") app.setAppUserModelId(windowsAppId());
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let exiting: Promise<boolean> | null = null;
let preferences: Preferences;
let preferencePath = "";
let closingRequested = false;
let preferenceWrites: Promise<unknown> = Promise.resolve();
let feedbackUpdates: Promise<void> = Promise.resolve();
let collectionReady: Promise<void> = Promise.resolve();
let startingCapture: Promise<void> | null = null;
let previewSourceId: string | null = null;
let previewOwner: string | null = null;
let playbackRequest: { id: string; controller: AbortController } | undefined;
const mediaFiles = new Map<string, string>();
const mediaKeys = new Map<string, string>();
const stateChanges = new StateChanges();
const executableName = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);
const helperPath = (name: string) =>
   isPackagedApp() ? join(process.resourcesPath, "recorder", executableName(name)) : resolve(here, "../../resources/recorder", executableName(name));
const iconFile = (file: string) => (isPackagedApp() ? join(process.resourcesPath, "icons", file) : resolve(here, "../../build", file));
const iconPath = () => iconFile(process.platform === "win32" ? "icon.ico" : "icon.png");
const capturing = () => recorder.status.state === "recording" || recorder.status.state === "waiting";
const captureActive = () => capturing() || recorder.status.state === "starting" || !!startingCapture;
const windowShown = () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
const applicationArtwork = (sources: CaptureSource[]): ApplicationArtwork[] =>
   sources.flatMap((source) =>
      source.applicationId
         ? [{ id: source.applicationId, icon: source.appIcon ?? "", ...(source.applicationName ? { name: source.applicationName } : {}) }]
         : []
   );
function assertFolderChangesAllowed(): void {
   if (recorder.status.pendingSaves) throw new Error("Wait for clips to finish saving before changing folders.");
}
// When each export started running, so stats can report how long encoding took.
const jobStarts = new Map<string, number>();
const collections = new CollectionService({
   applications: () => applicationArtwork(captureSources.cached),
   beforeFolderChange: assertFolderChangesAllowed,
   scanConcurrency: () => (captureActive() ? 1 : 3),
   backgroundStrips: true,
   onChange: () => emitState(),
   onJob: (job) => {
      // A shareable asked for in the library answers there; one made after a hotkey save needs the banner.
      if (job.state === "failed") notice(job.message, true, "info", collections.automaticJob(job.id) ? "background" : "action");
      if (job.state === "running" && !jobStarts.has(job.id)) jobStarts.set(job.id, Date.now());
      if (["complete", "failed", "cancelled"].includes(job.state)) {
         const started = jobStarts.get(job.id);
         jobStarts.delete(job.id);
         const clip = collections.clips.find((item) => item.id === job.clipId);
         const shareable = clip?.shareables.find((item) => item.id === job.id);
         if (job.state === "complete" && clip && shareable)
            stats.record({
               type: "shareable",
               clipId: clip.id,
               targetMB: shareable.targetMB,
               bytes: shareable.size,
               sourceBytes: clip.size,
               encodeSeconds: started ? (Date.now() - started) / 1000 : 0,
               automatic: collections.automaticShareable(clip.id, shareable.id),
            });
      }
   },
   onWarning: (message, level) => (level === "log" ? log(message, "warn") : notice(message, level === "error", "info", "app", { tone: level })),
   mediaUrl,
});
const stats = new StatsLog({
   root: () => collections.root,
   directory: (root) => collections.statsDirectory(root),
   // Preferences load after the services exist; nothing records before then.
   enabled: () => (preferences as Preferences | undefined) !== undefined,
   onError: (message) => log(message),
});
/** The clip a collection file belongs to, and whether it is the clip itself or a shareable. */
function fileOwner(path: string): { clipId: string; file: "clip" | "shareable" } | undefined {
   for (const clip of collections.clips) {
      if (samePath(clip.path, path)) return { clipId: clip.id, file: "clip" };
      if (clip.shareables.some((share) => samePath(share.path, path))) return { clipId: clip.id, file: "shareable" };
   }
   return undefined;
}
function action(name: StatsAction, clipId?: string) {
   stats.record({ type: "action", action: name, ...(clipId ? { clipId } : {}) });
}
// Capabilities need the recorder running, so a report uses the last answer instead of starting it.
let knownCapabilities: RecordingCapabilities | null = null;
async function recordingCapabilities(): Promise<RecordingCapabilities> {
   knownCapabilities = await recorder.capabilities();
   return knownCapabilities;
}
function systemDescription(): string {
   return describeSystem({
      platform: process.platform,
      release: release(),
      arch: process.arch,
      ...(process.platform === "darwin" ? { macVersion: process.getSystemVersion() } : {}),
      wayland: process.platform === "linux" && isWaylandSession(),
      ...(process.env["XDG_CURRENT_DESKTOP"] ? { desktop: process.env["XDG_CURRENT_DESKTOP"] } : {}),
   });
}
/** Where exports land without asking. Tests keep them inside their profile. */
function exportDirectory(): string {
   if (process.env["ACROCLIP_TEST"] === "1") return join(app.getPath("userData"), "exports");
   try {
      return app.getPath("downloads");
   } catch {
      return app.getPath("home");
   }
}
const gpuInfoSchema = z
   .object({
      gpuDevice: z
         .array(z.object({ vendorId: z.number().optional(), deviceId: z.number().optional(), driverVersion: z.string().optional() }).loose())
         .optional(),
   })
   .loose();
async function systemReport() {
   const gpu = gpuInfoSchema.safeParse(await app.getGPUInfo("basic").catch(() => ({})));
   const primary = screen.getPrimaryDisplay().id;
   const free = collections.root
      ? await statfs(collections.root, { bigint: true })
           .then((space) => Number(space.bavail * space.bsize))
           .catch(() => undefined)
      : undefined;
   return buildSystemReport({
      generatedAt: Date.now(),
      app: {
         version: app.getVersion(),
         packaged: isPackagedApp(),
         portable: !!process.env["PORTABLE_EXECUTABLE_FILE"],
         appImage: !!process.env["APPIMAGE"],
         startedAt: appStartedAt,
         locale: app.getLocale(),
      },
      runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 },
      os: {
         platform: process.platform,
         release: release(),
         version: process.platform === "darwin" ? process.getSystemVersion() : kernelVersion(),
         arch: arch(),
         wayland: process.platform === "linux" && isWaylandSession(),
         ...(process.env["XDG_CURRENT_DESKTOP"] ? { desktop: process.env["XDG_CURRENT_DESKTOP"] } : {}),
      },
      hardware: { cpu: cpus()[0]?.model.trim() ?? "unknown", cores: cpus().length, memoryBytes: totalmem(), freeMemoryBytes: freemem() },
      gpu: {
         features: app.getGPUFeatureStatus() as unknown as Record<string, string>,
         devices: (gpu.success ? (gpu.data.gpuDevice ?? []) : []).map((device) => ({
            ...(device.vendorId !== undefined ? { vendorId: device.vendorId } : {}),
            ...(device.deviceId !== undefined ? { deviceId: device.deviceId } : {}),
            ...(device.driverVersion ? { driver: device.driverVersion } : {}),
         })),
      },
      displays: screen.getAllDisplays().map((display) => ({
         width: display.size.width,
         height: display.size.height,
         scaleFactor: display.scaleFactor,
         refreshRate: display.displayFrequency,
         primary: display.id === primary,
      })),
      recorder: { state: recorderState(), capabilities: knownCapabilities },
      collection: {
         phase: collections.phase,
         ...(collections.scanError ? { error: collections.scanError } : {}),
         clips: collections.clips,
         folders: collections.folders.length,
         categories: collections.categories.length,
         jobs: collections.pendingJobs.length,
         ...(free !== undefined ? { freeBytes: free } : {}),
      },
      preferences,
      update: updates.state,
      sessions: await diagnostics.history(),
   });
}
const archiveReadme = `AcroClip diagnostics

logs/app.log            What AcroClip did and what went wrong, newest at the end.
logs/recorder.log       The capture helper's own log, from OBS.
logs/*.previous         The same logs from before they last rotated.
logs/sessions.jsonl     Recent runs, and whether each one closed cleanly.
system.json             Versions, hardware, displays, settings and library counts.

No clips, thumbnails or audio are included. Your user folder appears as ~.
The logs do name capture sources, so a captured window's title can appear in them.
`;
async function writeLogArchive(destination: string) {
   const redact = homeRedactor(homedir());
   const report = await systemReport();
   log(`diagnostics: exporting logs`);
   const entries = [
      { name: "README.txt", data: archiveReadme },
      ...(await diagnostics.entries(redact)),
      { name: "system.json", data: redact(JSON.stringify(report, null, 3)) },
   ];
   await writeFile(destination, createZip(entries));
}
// The capture session in progress, recorded as one event when it ends.
let captureSession: { startedAt: number; sourceKind?: "screen" | "app"; application?: string; source?: string } | null = null;
function trackCaptureSession(current: RecorderState) {
   if (current.state === "recording") {
      captureSession ??= { startedAt: current.startedAt ?? Date.now() };
      const footage = bufferedCaptureSource(current);
      if (footage.kind === "screen" || footage.kind === "app") captureSession.sourceKind = footage.kind;
      if (footage.name) captureSession.source = footage.name;
      if (lastRecordingArtwork?.application.id) captureSession.application = lastRecordingArtwork.application.id;
   } else if (captureSession && current.state !== "waiting" && current.state !== "starting") endCaptureSession(current.state === "error" ? "error" : "stopped");
}
function endCaptureSession(ended: "stopped" | "error" | "exit" | "collection") {
   if (!captureSession) return;
   const { startedAt, ...rest } = captureSession;
   captureSession = null;
   stats.record({ type: "capture", startedAt, seconds: Math.max(0, (Date.now() - startedAt) / 1000), ...rest, ended });
}
// Capture transitions explain most "it stopped recording" reports, so each one reaches the log.
let loggedCapture = "";
function logCaptureState(current: RecorderState) {
   const source = current.sourceKind ? ` ${current.sourceKind}${current.sourceName ? ` "${current.sourceName}"` : ""}` : "";
   const line = `${current.state}${source}${current.message ? `: ${current.message}` : ""}${current.audioWarning ? ` (audio: ${current.audioWarning})` : ""}`;
   if (line === loggedCapture) return;
   loggedCapture = line;
   log(`capture: ${line}`, current.state === "error" ? "error" : "info");
}
// When the window last came on screen, recorded as one stretch when it leaves.
let windowShownSince: number | null = null;
function trackWindow(visible: boolean) {
   if (visible) windowShownSince ??= Date.now();
   else if (windowShownSince !== null) {
      stats.record({ type: "window", seconds: Math.max(0, (Date.now() - windowShownSince) / 1000) });
      windowShownSince = null;
   }
}
const libraryRefresh = new CollectionRefresh({
   refresh: () => collections.refresh(),
   busy: () => collections.pendingJobs.length > 0,
   log: (message) => log(message),
});
const updates = new Updates(
   () => emitState(),
   (message) => log(message)
);
const feedback = new Feedback(helperPath("acroclip-notifier"), (message) => log(message), iconPath());
const recordingStatus: Record<RecordingNoticeKind, NonNullable<FeedbackDetails["recordingStatus"]>> = {
   "recording-starting": "starting",
   "recording-progress": "starting",
   "recording-started": "recording",
   "game-found": "recording",
   "game-lost": "paused",
   "recording-paused": "paused",
   "recording-resumed": "recording",
   "recording-stopped": "stopped",
   "critical-error": "error",
};
/** A clip or source thumbnail fills the banner tile. Without one, the application icon sits inside it. */
function bannerArtwork(thumbnail: string | undefined, icon: string | undefined): FeedbackDetails {
   return thumbnail ? { artwork: thumbnail } : { artwork: icon ?? "", artworkIcon: true };
}
/** Finding a game or application shows its own icon. Without one, it falls back to the capture graphic. */
function capturedArtwork(kind: RecordingNoticeKind): FeedbackDetails {
   const icon = kind === "game-found" || kind === "recording-resumed" ? lastRecordingArtwork?.application.icon : undefined;
   return icon ? { artwork: icon, artworkIcon: true } : { recordingStatus: recordingStatus[kind] };
}
/** Linux capture follows the chosen window's process, which cannot come back once it exits. */
function chosenApplicationClosed(): boolean {
   if (process.platform !== "linux" || preferences.sourceKind !== "app") return false;
   const pid = captureSources.processOf(preferences.sourceId);
   if (!pid) return false;
   try {
      process.kill(pid, 0);
      return false;
   } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
   }
}
const recordingNotices = new RecordingNotices(
   (entry) => {
      // A new attempt retires the previous capture error waiting in the status bar.
      if (entry.kind === "recording-starting") send({ type: "notice-clear", key: "capture" });
      notice(
         entry.message,
         entry.error,
         entry.kind,
         "background",
         { key: "capture", ...(entry.detail ? { detail: entry.detail } : {}) },
         { ...capturedArtwork(entry.kind), ...(entry.error ? { errorTitle: entry.message } : {}) }
      );
   },
   Date.now,
   chosenApplicationClosed
);

// The banner's second line says what to do. Without one it would only repeat the app's name.
const storageAdvice: Record<string, string> = {
   "Low storage in clip folder": "Free up space so new clips can save.",
   "Free storage could not be checked": "AcroClip will check again shortly.",
};
// The status bar shows low storage as a condition, so the app side stays quiet here.
const storage = new StorageMonitor({
   onChange: () => emitState(),
   onWarning: (message) => notice(message, false, "info", "native", { tone: "warning", ...(storageAdvice[message] ? { detail: storageAdvice[message] } : {}) }),
});
const recorder = new Recorder({
   gameCatalogPath: join(app.getPath("userData"), "game-catalog.json"),
   onCatalogWarning: (message) => log(message),
   onAudioMonitorError: (monitorError, listeningError) =>
      send({ type: "audio-monitor", monitorError, ...(listeningError !== undefined ? { listeningError } : {}) }),
   onAudioLevels: (levels) => {
      if (windowShown())
         send({
            type: "audio-levels",
            levels: {
               capture: levels.capture * 100,
               microphone: levels.microphone * 100,
               ...(levels.additional ? { additional: Object.fromEntries(Object.entries(levels.additional).map(([id, level]) => [id, level * 100])) } : {}),
            },
         });
   },
   nativePath: helperPath("acroclip-recorder"),
   onOutput: (text) => diagnostics.recorderOutput(text),
   onLifecycle: (event) => {
      if (event.kind === "started") {
         diagnostics.recorderStarted(event.executable);
         log("recorder: started");
      } else
         log(
            `recorder: closed with code ${event.code ?? "none"}${event.signal ? `, signal ${event.signal}` : ""}${event.expected ? "" : " (unexpected)"}`,
            event.expected ? "info" : "error"
         );
   },
   onState: (current) => {
      logCaptureState(current);
      const footage = bufferedCaptureSource(current);
      if (current.state === "recording") lastRecordingArtwork = recordingArtwork(footage, captureSources.cached, lastRecordingArtwork);
      trackCaptureSession(current);
      recordingNotices.state(current, closingRequested);
      updateStorageActivity();
      send({ type: "recorder", recorder: recorderState() });
      updateTray();
   },
   onError: (message, context) =>
      queueMicrotask(() => {
         if (recordingNotices.handledError(message)) return;
         criticalFailure(
            context === "save" ? "Couldn't save clip" : context === "saved-clip" ? "Saved clip needs attention" : "Capture needs attention",
            message,
            context === "capture" ? "capture" : "save"
         );
      }),
   onSaved: async (path, source, _requestId, capture) => {
      const clip = await collections.registerRecording(path, source, capture.application);
      emitState();
      const request = [...savesRequested].find(([requested]) => samePath(requested, path));
      if (request) savesRequested.delete(request[0]);
      const footage: SavedFootage = {
         clipId: clip.id,
         session: capture.previousFootage ? "" : (request?.[1].session ?? ""),
         ...footageWindow(request?.[1].requestedAt ?? Date.now(), capture.secondsSinceCapture, clip.duration),
      };
      log(
         `save: ready after ${request ? Date.now() - request[1].requestedAt : "?"} ms, ${clip.duration.toFixed(1)} s ending ${capture.secondsSinceCapture.toFixed(2)} s before the request, ${clip.width}x${clip.height}, ${clip.tracks.length} audio tracks, ${Math.round(clip.size / 1024)} KiB${capture.previousFootage ? ", from previous footage" : ""}`
      );
      const previous = previousSave;
      const record = (outcome: "saved" | "extended", into?: string) =>
         stats.record({
            type: "save",
            clipId: clip.id,
            ...(request ? { latencyMs: Math.max(0, Date.now() - request[1].requestedAt) } : {}),
            seconds: clip.duration,
            outcome,
            ...(into ? { into } : {}),
            ...(capture.application?.id ? { application: capture.application.id } : {}),
            ...(clip.source ? { source: clip.source } : {}),
            ...(request ? { trigger: request[1].trigger } : {}),
            bufferSeconds: preferences.clipSeconds,
         });
      const candidate = mergeCandidate(previous, footage, {
         mode: preferences.overlapClips,
         clipSeconds: preferences.clipSeconds,
         previousUntouched: !!previous && collections.untouched(previous.clipId),
      });
      // The merge keeps the newer clip's path, so its name and thumbnail describe either outcome.
      const banner: FeedbackDetails = { detail: basename(path), ...bannerArtwork(feedbackThumbnail(clip.thumbnail), capture.application?.icon) };
      if (!candidate.merge || !previous) {
         previousSave = footage;
         record("saved");
         reportSave({ kind: "saved", previousFootage: capture.previousFootage }, banner);
         autoShare(clip.id);
         return;
      }
      // A chain keeps growing from the first clip's start.
      previousSave = { ...footage, start: previous.start };
      record("extended", previous.clipId);
      reportSave({ kind: "extended", seconds: candidate.seconds, added: candidate.added }, banner);
      merges = merges.then(() => mergeSaves(previous.clipId, clip.id)).catch((error: unknown) => log(`merge: ${errorMessage(error)}`, "error"));
   },
});
const captureSources = new CaptureSources(
   recorder,
   () => mainWindow?.getMediaSourceId().split(":")[1] ?? "",
   (sources) => {
      send({ type: "capture-sources", sources });
      void collections.enrichApplications(applicationArtwork(sources)).catch(() => undefined);
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
   const exposed: RecorderState = startingCapture && current.state === "stopped" ? { ...current, state: "starting", message: "Starting capture" } : current;
   const startingDetail = recordingNotices.startingDetail;
   return startingDetail === undefined ? exposed : { ...exposed, startingDetail };
}
function state(): AppState {
   return {
      windowVisible: windowShown(),
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
   if (event.type !== "visibility" && !windowShown()) return;
   mainWindow.webContents.send("app-event", event);
}
function emitState() {
   if (!preferences) return;
   updateStorageActivity();
   libraryRefresh.update(collections.root, windowShown());
   // Do not advance the baseline while the renderer cannot receive updates.
   if (!windowShown()) return;
   const event = stateChanges.event(state());
   if (event) send(event);
}
function updateStorageActivity() {
   storage.setActivity(collections.root, captureActive() || recorder.status.pendingSaves > 0 || collections.pendingJobs.length > 0);
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
function feedbackThumbnail(url: string): string {
   try {
      const path = mediaFiles.get(new URL(url).pathname.slice(1));
      if (!path) return "";
      const image = nativeImage.createFromPath(path);
      return image.isEmpty() ? "" : image.resize({ height: 128 }).toDataURL();
   } catch {
      return "";
   }
}
/** Diagnostics never throw into the caller: a full disk must not break capture. */
function log(message: string, level: LogLevel = "info") {
   diagnostics.log(message, level);
}
let visibleNotificationAction: NotificationAction | null = null;
/** Capture and save errors each keep one chip, replaced by the next error and cleared once that part works again. */
function criticalFailure(title: string, detail: string, key: "capture" | "save" = "capture"): void {
   notice(title, true, "critical-error", "background", { key, ...(detail ? { detail } : {}) }, { errorTitle: title, recordingStatus: "error" });
}
/** `surface` only applies to refusals like "already running". Capture and save failures always reach the banner. */
function captureActionError(error: unknown, surface: NoticeSurface = "background"): void {
   const message = errorMessage(error);
   const save = error instanceof SaveFailure;
   const report = captureErrorReport(
      message,
      { save, timedOut: save && error.cause instanceof CaptureTimeout },
      { handled: recordingNotices.handledError(message), errored: recorder.status.state === "error", reported: recordingNotices.hasReportedError }
   );
   if (report.type === "log") log(message, "error");
   else if (report.type === "critical") criticalFailure(report.title, report.detail, report.key);
   else if (report.type === "notice") notice(message, true, "info", surface);
}
function notice(
   message: string,
   error = false,
   kind: NoticeKind = "info",
   surface: NoticeSurface = "background",
   options: NoticeOptions = {},
   details: FeedbackDetails = {}
) {
   const route = routeNotice(message, error, kind, surface, options, { preferences, focused: windowShown() && !!mainWindow?.isFocused() });
   if (route.app) send({ type: "notice", ...route.app });
   log(options.detail ? `${message}. ${options.detail}` : message, error ? "error" : options.tone === "warning" ? "warn" : "info");
   if (!route.feedback) return;
   feedbackUpdates = feedbackUpdates.then(() => showFeedback(message, error, kind, options, details)).catch(() => undefined);
}
function showFeedback(message: string, error: boolean, kind: NoticeKind, options: NoticeOptions, details: FeedbackDetails) {
   const request = feedbackRequest(error, kind, options, preferences, visibleNotificationAction);
   if (request.visual) visibleNotificationAction = request.action;
   const sound = request.sound ? join(isPackagedApp() ? process.resourcesPath : resolve(here, "../../resources"), "feedback", request.sound) : undefined;
   feedback.show(message, error, request.busy, {
      ...details,
      ...(options.detail ? { detail: options.detail } : {}),
      completed: request.completed,
      replay: request.replay,
      pulse: request.pulse,
      visual: request.visual,
      preserveBanner: request.preserveBanner,
      ...(sound ? { sound } : {}),
   });
}
function refreshNotificationVisibility(): void {
   if (visibleNotificationAction && !notificationDelivery(preferences, visibleNotificationAction).banner) {
      feedback.show("", false, false, { visual: false });
      visibleNotificationAction = null;
   }
}
let lastRecordingArtwork: RecordingArtwork | undefined;
// Saves waiting for the recorder, by destination, and the last clip a new save may merge into.
const savesRequested = new Map<string, { requestedAt: number; session: string; trigger: SaveTrigger }>();
let previousSave: SavedFootage | undefined;
let merges: Promise<void> = Promise.resolve();
/** A merge reports after its save was announced. Its correction shows on the save banner without a second chime. */
function reportSave(outcome: SaveOutcome, details: FeedbackDetails = {}) {
   const correction = outcome.kind === "kept-both" || outcome.kind === "extended-previous-kept";
   if (!correction) send({ type: "notice-clear", key: "save" });
   const { message, detail } = saveOutcomeNotice(outcome);
   notice(message, false, correction ? "save-note" : "saved", "native", detail ? { detail } : {}, details);
}
function autoShare(clipId: string) {
   const clip = collections.clips.find((item) => item.id === clipId);
   if (!clip || !preferences.autoShare || !shareableTargetAllowed(clip.size, preferences.shareSizeMB)) return;
   void collections.createShareable(clip.id, preferences.shareSizeMB, true).catch((e) => notice(errorMessage(e), true));
}
/** Runs after the newer clip is saved and announced. Anything unexpected keeps both clips. */
async function mergeSaves(olderId: string, newerId: string) {
   await collections.cancelAutomaticShareables(olderId);
   const outcome = await collections.mergeRecordings(olderId, newerId, (path) => shell.trashItem(path));
   emitState();
   if (!outcome.merged) {
      log(`merge: kept both clips. ${outcome.reason}`);
      if (previousSave?.clipId === newerId) {
         const own = collections.clips.find((item) => item.id === newerId);
         if (own) previousSave = { ...previousSave, start: previousSave.end - own.duration * 1000 };
      }
      reportSave({ kind: "kept-both" });
   } else if (outcome.previousKept) reportSave({ kind: "extended-previous-kept" });
   else if (windowShown() && mainWindow?.isFocused()) notice("Extended the previous clip. The shorter version is in the trash.", false, "info", "app");
   autoShare(newerId);
}
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
      const visible = windowShown();
      trackWindow(visible);
      libraryRefresh.update(collections.root, visible);
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
   mainWindow.webContents.on("render-process-gone", (_event, details) => {
      log(`renderer: gone (${details.reason}, exit code ${details.exitCode})`, details.reason === "clean-exit" ? "info" : "error");
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
   mainWindow.on("unresponsive", () => log("renderer: window stopped responding", "warn"));
   mainWindow.on("responsive", () => log("renderer: window responds again"));
   mainWindow.webContents.on("preload-error", (_event, path, error) => log(`renderer: preload ${path} failed: ${error.stack ?? error.message}`, "error"));
   mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   mainWindow.webContents.on("will-navigate", (event, url) => {
      if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
   });
   const dev = process.env["ELECTRON_RENDERER_URL"];
   if (dev) void mainWindow.loadURL(dev);
   else void mainWindow.loadFile(join(here, "../renderer/index.html"));
}
function trayIcon() {
   const image = nativeImage.createFromPath(iconFile("icon.png"));
   if (image.isEmpty()) throw new Error("AcroClip's app icon is missing. Rebuild the app icons.");
   return image.resize({ width: 20, height: 20 });
}
function updateTray() {
   if (!tray) return;
   const active = capturing();
   renderTray(tray, recorder.status, !!startingCapture, {
      open: () => {
         mainWindow?.show();
         mainWindow?.focus();
      },
      toggleRecording: () => void (active ? stopRecording() : startRecording()).catch(captureActionError),
      saveClip: () => void saveClip("tray").catch(captureActionError),
      exit: () => void requestExit(),
   });
}
async function ensureMicrophoneAccess(value: Preferences): Promise<void> {
   if (process.platform === "darwin" && needsMicrophonePermission(value) && systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
      if (!(await systemPreferences.askForMediaAccess("microphone")))
         throw new Error("Allow microphone access in System Settings, or mute microphone sources.");
   }
}
/** `quiet` is for starts AcroClip makes itself, like capturing on launch. Only failures speak up. */
async function startRecording(options: { quiet?: boolean } = {}) {
   if (!preferences.setupComplete) throw new Error("Finish setup before capturing.");
   if (closingRequested) throw new Error("AcroClip is preparing to exit. Keep the app open to record.");
   if (captureActive()) throw new Error("Capture is already running.");
   lastRecordingArtwork = undefined;
   recordingNotices.starting(preferences.sourceKind === "auto" ? "Automatic game detection" : recordingSourceLabel(preferences, captureSources.cached), {
      mode: preferences.sourceKind,
      quiet: options.quiet === true,
   });
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
   } catch (error) {
      recordingNotices.startFailed(errorMessage(error));
      throw error;
   } finally {
      startingCapture = null;
      emitState();
      updateTray();
   }
}
/** A source the user picks mid-capture is a move, not a find or a loss, so notices start over from it. */
async function switchCaptureSource(value: Preferences, sources: CaptureSource[]) {
   recordingNotices.switching(value.sourceKind);
   try {
      await recorder.switchSource(value, sources);
   } finally {
      recordingNotices.switched();
   }
}
async function stopRecording() {
   if (!startingCapture && !["starting", "recording", "waiting"].includes(recorder.status.state)) return;
   recordingNotices.stoppingRequested();
   await startingCapture?.catch(() => undefined);
   try {
      await recorder.stop();
   } catch (error) {
      recordingNotices.stopFailed();
      throw error;
   }
}
async function saveClip(trigger: SaveTrigger) {
   const requestedAt = Date.now();
   if (closingRequested) throw new Error("AcroClip is preparing to exit. Keep the app open to save another clip.");
   if (!capturing()) throw new Error("Start capturing before saving a clip.");
   if (!collections.root) throw new Error("The collection folder is still opening. Try saving again when it is available.");
   try {
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
      const status = recorder.status;
      const session = status.startedAt ? `${status.startedAt}:${status.bufferedSourceId || status.sourceId || ""}` : "";
      // A save the recorder rejects never reports back, so forget requests long past any save.
      for (const [path, request] of savesRequested) if (request.requestedAt < requestedAt - 600_000) savesRequested.delete(path);
      savesRequested.set(destination, { requestedAt, session, trigger });
      log(`save: requested by ${trigger}, ${preferences.clipSeconds} s, ${status.availableSeconds.toFixed(1)} s available from ${footage.kind ?? "unknown"}`);
      try {
         await recorder.save(destination, requestedAt, lastRecordingArtwork?.application);
      } catch (error) {
         savesRequested.delete(destination);
         throw error;
      }
      // The status bar shows saves in progress, so this only reaches the desktop banner.
      notice(
         "Saving clip…",
         false,
         "saving",
         "native",
         { detail: applicationName },
         bannerArtwork(captureSources.cached.find((source) => source.id === footage.id)?.thumbnail, lastRecordingArtwork?.application.icon)
      );
   } catch (error) {
      log(`save: refused: ${errorMessage(error)}`, "error");
      throw new SaveFailure(errorMessage(error), { cause: error });
   }
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
      if (update) log(`update: exit ${name} at ${Date.now() - started} ms`);
   };
   exiting = (async () => {
      await preferenceWrites.catch(() => undefined);
      await startingCapture?.catch(() => undefined);
      await merges;
      await collections.finishFileChanges();
      phase("settled files");
      const saves = recorder.status.pendingSaves;
      if (update && !collections.pendingJobs.length) {
         // Restarting into an update is already the user's answer to "exit?". Clip
         // saves finish first, so no requested moment is lost to the installer.
         if (saves) options.progress?.(`Finishing ${saves === 1 ? "clip save" : `${saves} clip saves`}`);
         await recorder.close();
         phase("closed the recorder");
      } else if (saves || collections.pendingJobs.length) {
         const decision = await pendingExitDecision(
            () => !!recorder.status.pendingSaves || collections.pendingJobs.length > 0,
            async (signal) =>
               (
                  await dialog.showMessageBox({
                     type: "question",
                     title: "Work is still running",
                     message: "Finish before exiting?",
                     detail: `${saves ? `${saves} clip save${saves === 1 ? "" : "s"}` : ""}${saves && collections.pendingJobs.length ? " and " : ""}${collections.pendingJobs.length ? `${collections.pendingJobs.length} shareable${collections.pendingJobs.length === 1 ? "" : "s"}` : ""} still in progress.`,
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
            for (const job of collections.pendingJobs) collections.cancelJob(job.id);
            await recorder.close({ cancel: true });
            await collections.jobsSettled();
         } else {
            options.progress?.("Finishing work");
            await recorder.stop();
            await recorder.close();
            await collections.jobsSettled();
         }
         phase("finished work");
      } else {
         if (capturing()) {
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
   if (!collections.pendingJobs.length) mainWindow?.hide();
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
      void startRecording({ quiet: true }).catch(captureActionError);
}
function clearBrowserCache() {
   return Promise.all([session.defaultSession.clearCache(), session.defaultSession.clearCodeCaches({})]);
}
/** Runs once the app is ready to quit: capture is closed and nothing else writes these files. */
async function factoryReset(parts: readonly ResetPart[]) {
   const root = collections.root;
   const steps: Record<ResetPart, () => Promise<unknown>> = {
      stats: async () => root && (await stats.clear(root)),
      cache: async () => {
         await clearBrowserCache();
         if (root) for (const folder of ["thumbnails", "playback"]) await rm(join(root, ".acroclip", folder), { recursive: true, force: true });
      },
      layout: () => session.defaultSession.clearStorageData({ storages: ["localstorage"] }),
      settings: async () => {
         if (preferences.startWithOS) await applyStartup(false);
         // Without a file, the next launch starts from the defaults and runs setup.
         for (const path of [preferencePath, `${preferencePath}.bak`]) await rm(path, { force: true });
      },
      logs: () => diagnostics.clear(),
   };
   // Logs go last, so a failure in another step is cleared with them rather than left behind.
   for (const part of [...parts.filter((part) => part !== "logs"), ...parts.filter((part) => part === "logs")]) {
      try {
         await steps[part]();
      } catch (error) {
         log(`maintenance: factory reset of ${part} failed: ${errorMessage(error)}`, "error");
      }
   }
}
function releaseServices() {
   diagnostics.end();
   libraryRefresh.close();
   storage.close();
   feedback.close();
   globalShortcut.unregisterAll();
}
async function requestExit() {
   try {
      if (await prepareExit()) {
         endCaptureSession("exit");
         trackWindow(false);
         await stats.flush();
         quitting = true;
         releaseServices();
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
/** Channels that work before the collection finishes opening. */
const collectionIndependent = new Set([
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
   // A bug report must work when the collection is what's broken.
   "diagnostics-error",
   "logs-export",
   "bug-report",
   "history-clear",
   "factory-reset",
]);
/** Changes refused once exiting has begun. */
const changesWhileExiting = new Set([
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
]);
// Playback and preview report errors locally and discard obsolete requests.
// A global notice would outlive a source or file switch. Hover strips and view
// history run in the background, so their failures only reach the log.
const locallyReported = new Set([
   "playback",
   "cancel-playback",
   "preview-source",
   "monitor-audio",
   "listen-audio",
   "preferences",
   "keyframes",
   "loudness",
   "stats-view",
   "stats-summary",
   "diagnostics-error",
]);
function handle(channel: string, fn: (...args: unknown[]) => unknown) {
   ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (event.sender !== mainWindow?.webContents) throw new Error("Unknown window");
      try {
         if (!collectionIndependent.has(channel)) await collectionReady;
         if (closingRequested && changesWhileExiting.has(channel)) throw new Error("AcroClip is preparing to exit. Keep the app open to make changes.");
         return await fn(...args);
      } catch (e) {
         // Capture errors reach the banner even from a click, and the renderer leaves them to main.
         if (channel === "record-start" || channel === "record-stop" || channel === "record-save") captureActionError(e, "action");
         else if (locallyReported.has(channel)) log(`${channel}: ${errorMessage(e)}`, "warn");
         else notice(errorMessage(e), true, "info", "action");
         throw e;
      }
   });
}
let hotkeysSuspended = false;
const installedShortcuts = new Map<ShortcutAction, string>();
function globalAction(id: ShortcutAction): void {
   const active = capturing();
   const operation =
      id === "saveClip"
         ? saveClip("shortcut")
         : id === "stopRecording" || (id === "toggleRecording" && active)
           ? stopRecording()
           : active || startingCapture
             ? Promise.resolve()
             : startRecording();
   void operation.catch(captureActionError);
}
const shortcutLabel = (id: ShortcutAction) => shortcutRegistry.find((item) => item.id === id)!.label;
function suspendShortcuts(enabled: boolean): void {
   if (hotkeysSuspended === enabled) return;
   hotkeysSuspended = enabled;
   for (const [id, key] of installedShortcuts) {
      if (enabled) globalShortcut.unregister(key);
      else if (!globalShortcut.register(key, () => globalAction(id)))
         notice(`${shortcutLabel(id)} shortcut is unavailable. Choose another in Settings.`, true, "info", "action");
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
      else if (startup) notice(`${shortcutLabel(id)} shortcut is unavailable. Choose another in Settings.`, true);
      else {
         restore();
         throw new Error(`${shortcutLabel(id)} shortcut isn't available. Choose another key combination.`);
      }
   }
   return restore;
}
function registerIPC() {
   handle("capture-shortcut", (enabled) => suspendShortcuts(z.boolean().parse(enabled) && windowShown()));
   handle("recording-capabilities", () => recordingCapabilities());
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
      if (!windowShown() || !preferences.setupComplete) throw new Error("Open Capture to preview the capture source.");
      const selected = previewCaptureSource(captureSources.cached, preferences, recorder.status);
      if (!selected || selected.id !== requested) throw new Error("The selected preview source is unavailable.");
      previewSourceId = requested;
      previewOwner = owner ?? null;
   });
   handle("listen-audio", async (source) => {
      const id = z.string().max(200).nullable().parse(source);
      if (id && (!windowShown() || !preferences.setupComplete)) throw new Error("Open Capture to listen.");
      if (id && !capturing() && recorder.status.state !== "starting") await recorder.monitorAudio(preferences);
      return recorder.listenAudio(id);
   });
   handle("monitor-audio", (enabled) =>
      recorder.monitorAudio(
         z.boolean().parse(enabled) && preferences.setupComplete && windowShown()
            ? monitoringPreferences(preferences, preferences.sourceKind === "auto" || !!selectedCaptureSource(captureSources.cached, preferences))
            : null
      )
   );
   handle("audio-devices", (kind) => recorder.audioDevices(z.enum(["input", "output"]).default("input").parse(kind)));
   handle("choose-folder", async () => {
      const picked = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], defaultPath: preferences.collection });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
   });
   /** Every settings change goes through here, one at a time, and rolls back as a whole. */
   function applyPreferences(build: () => Preferences): Promise<AppState> {
      const operation = preferenceWrites
         .catch(() => undefined)
         .then(async () => {
            if (startingCapture) throw new Error("Capture is starting. Wait before applying settings.");
            const next = build();
            if (audioTopology(next) !== audioTopology(preferences) || next.sourceKind !== preferences.sourceKind || next.sourceId !== preferences.sourceId)
               assertDistinctAudioSources(next, captureSources.cached);
            if (!next.collection.trim()) throw new Error("Choose a collection folder.");
            if (!isValidShortcut(next.shortcut)) throw new Error("That key combination is not supported. Try a letter, number, or function key.");
            if (recorder.status.state !== "stopped" && recorder.status.state !== "error" && requiresCaptureRestart(preferences, next))
               throw new Error("Stop capturing to apply these changes. Footage you haven't saved will be discarded.");
            if (
               next.collection !== preferences.collection &&
               (recorder.status.state !== "stopped" || recorder.status.pendingSaves || collections.pendingJobs.length)
            )
               throw new Error("Stop capturing and finish shareables before changing the collection folder.");
            const conflict = shortcutConflict(next, process.platform === "darwin");
            if (conflict) throw new Error(conflict);
            for (const item of shortcutRegistry) {
               const key = bindingFor(next, item.id);
               if (key && !isValidShortcut(key)) throw new Error(`Choose a valid shortcut for ${item.label}.`);
            }
            const rollbackShortcuts = installShortcuts(next);
            const sourceChanged =
               next.sourceId !== preferences.sourceId ||
               next.sourceKind !== preferences.sourceKind ||
               next.desktopFallback !== preferences.desktopFallback ||
               JSON.stringify(next.customGames) !== JSON.stringify(preferences.customGames);
            const reportRollback = (error: unknown) => notice(errorMessage(error), true, "info", "action");
            try {
               if (needsMicrophonePermission(next) && !needsMicrophonePermission(preferences)) await ensureMicrophoneAccess(next);
               if (next.collection !== preferences.collection) {
                  // Events belong to the collection they happened in.
                  endCaptureSession("collection");
                  trackWindow(false);
                  await stats.flush();
                  await collections.open(next.collection);
                  trackWindow(windowShown());
               }
               if (capturing() && sourceChanged) await switchCaptureSource(next, await captureSources.list());
               if (next.startWithOS !== preferences.startWithOS) await applyStartup(next.startWithOS);
               if (capturing())
                  for (const source of next.audioSources.filter((source) => source.enabled))
                     await recorder.setAudio({ source: source.id, volume: source.volume, muted: source.muted, filters: source.filters });
               await writePreferences(preferencePath, next);
            } catch (e) {
               rollbackShortcuts();
               if (next.collection !== preferences.collection && collections.root !== resolve(preferences.collection))
                  await collections.open(preferences.collection).catch(reportRollback);
               if (capturing() && sourceChanged) await switchCaptureSource(preferences, captureSources.cached).catch(reportRollback);
               if (next.startWithOS !== preferences.startWithOS) await applyStartup(preferences.startWithOS).catch(reportRollback);
               if (capturing())
                  for (const source of preferences.audioSources.filter((source) => source.enabled))
                     await recorder.setAudio({ source: source.id, volume: source.volume, muted: source.muted, filters: source.filters }).catch(() => undefined);
               throw e;
            }
            if (next.sourceId !== preferences.sourceId || next.sourceKind !== preferences.sourceKind) previewSourceId = null;
            const changed = (Object.keys(next) as Array<keyof Preferences>).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(preferences[key]));
            preferences = next;
            feedbackUpdates = feedbackUpdates.then(refreshNotificationVisibility).catch(() => undefined);
            if (changed.length) stats.record({ type: "settings", keys: changed.slice(0, 80) });
            recorder.updatePreferences(next);
            emitState();
            return state();
         });
      preferenceWrites = operation;
      return operation;
   }
   handle("preferences", (value, changedKeys) =>
      applyPreferences(() => synchronizeLegacyAudio(preferences, mergePreferenceChanges(preferences, value, changedKeys)))
   );
   // Applies live like any other change, so nothing needs a restart.
   handle("preferences-reset", (value) => {
      const parts = preferenceResetSchema.parse(value);
      return applyPreferences(() => {
         if (parts.setup && (captureActive() || recorder.status.pendingSaves)) throw new Error("Stop capturing before resetting the recording setup.");
         log(`maintenance: reset ${[parts.settings ? "settings" : "", parts.setup ? "recording setup" : ""].filter(Boolean).join(" and ")}`, "warn");
         return mergePreferenceChanges(preferences, resetPreferenceGroups(preferences, parts), undefined);
      });
   });
   handle("record-start", () => startRecording());
   handle("record-stop", () => stopRecording());
   handle("record-save", () => saveClip("app"));
   handle("share", (id, target) => {
      const clipId = idSchema.parse(id);
      const targetMB = target === undefined ? preferences.shareSizeMB : z.number().min(1).max(2000).parse(target);
      const clip = collections.clips.find((item) => item.id === clipId);
      if (!clip) throw new Error("This clip is no longer in the collection.");
      if (!shareableTargetAllowed(clip.size, targetMB)) throw new Error("Choose a shareable size target no larger than the clip.");
      return collections.createShareable(clipId, targetMB);
   });
   handle("cancel-job", (id) => collections.cancelJob(idSchema.parse(id)));
   handle("rename", async (id, name) => {
      const clipId = idSchema.parse(id);
      await collections.rename(clipId, z.string().trim().min(1).max(150).parse(name));
      action("rename", clipId);
   });
   const folderPathSchema = z.string().max(4096);
   handle("folder-create", async (parent, name) => {
      const created = await collections.createFolder(folderPathSchema.parse(parent), z.string().max(150).parse(name));
      action("folder-create");
      return created;
   });
   handle("folder-rename", async (path, name) => {
      const renamed = await collections.renameFolder(folderPathSchema.parse(path), z.string().max(150).parse(name));
      action("folder-rename");
      return renamed;
   });
   // Refuse before asking, so a pending save never leads to a confirmation that cannot apply.
   handle("folder-move", async (path, destination) => {
      assertFolderChangesAllowed();
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
      const moved = await collections.moveFolder(selected, target, contents.fingerprint);
      action("folder-move");
      return moved;
   });
   handle("clip-move", async (id, destination) => {
      const clipId = idSchema.parse(id);
      const moved = await collections.moveClip(clipId, folderPathSchema.parse(destination));
      if (moved) action("move", clipId);
      return moved;
   });
   handle("folder-delete", async (path) => {
      assertFolderChangesAllowed();
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
      await collections.trashFolder(selected, contents.fingerprint, (directory) => shell.trashItem(directory));
      action("folder-delete");
      return true;
   });
   handle("delete", async (id, shareId, scope) => {
      const clipId = idSchema.parse(id);
      const shareableId = shareId === undefined ? undefined : idSchema.parse(shareId);
      const selection = scope === undefined ? undefined : z.literal("shareables").parse(scope);
      if (collections.pendingJobs.some((j) => j.clipId === clipId)) throw new Error("Finish or cancel this clip's export before removing it.");
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
      const before = collections.clips.find((item) => item.id === clipId);
      const deleted: string[] = [];
      try {
         for (const path of await collections.filesForDeletion(clipId, shareableId, selection)) {
            await shell.trashItem(path);
            deleted.push(path);
         }
      } finally {
         await collections.removeDeleted(clipId, deleted);
         if (before && deleted.length)
            stats.record({
               type: "delete",
               clipId,
               scope: shareableId ? "shareable" : selection === "shareables" ? "shareables" : "clip",
               clipCreatedAt: before.createdAt,
               duration: before.duration,
               watched: !!before.watched,
               ...(before.applicationId ? { application: before.applicationId } : {}),
            });
      }
   });
   handle("category-reorder", (id, beforeId) => collections.reorderCategory(idSchema.parse(id), idSchema.nullable().parse(beforeId)));
   handle("category", async (operation, value) => {
      const request = categoryRequest.parse(value);
      // Tag counts compare before and after, so a no-op assignment records nothing.
      const tagsOf = (clipId: string) => new Set(collections.clips.find((clip) => clip.id === clipId)?.categories ?? []);
      const recordTags = (clipId: string, before: Set<string>) => {
         const after = tagsOf(clipId);
         if ([...after].some((id) => !before.has(id))) action("tag", clipId);
         if ([...before].some((id) => !after.has(id))) action("untag", clipId);
      };
      switch (z.enum(["create", "update", "delete", "assign", "toggle"]).parse(operation)) {
         case "create": {
            const created = await collections.createCategory(request.name ?? "New tag", request.color ?? "#b197fc", request.icon ?? "tag");
            action("tag-create");
            return created;
         }
         case "update":
            return collections.updateCategory(idSchema.parse(request.id), request.name ?? "", request.color ?? "#b197fc", request.icon ?? "tag");
         case "delete":
            await collections.deleteCategory(idSchema.parse(request.id));
            action("tag-delete");
            return;
         case "assign": {
            const clipId = idSchema.parse(request.clipId);
            const before = tagsOf(clipId);
            await collections.assignCategories(clipId, request.categoryIds ?? []);
            recordTags(clipId, before);
            return;
         }
         case "toggle": {
            const clipId = idSchema.parse(request.clipId);
            const before = tagsOf(clipId);
            await collections.toggleCategory(clipId, idSchema.parse(request.id));
            recordTags(clipId, before);
            return;
         }
      }
   });
   handle("clip-viewed", (id) => collections.markViewed(idSchema.parse(id)));
   handle("keyframes", (id) => collections.keyframeStrip(idSchema.parse(id)));
   handle("stats-view", (value) => {
      const event = viewEventSchema.parse(value);
      if (collections.clips.some((clip) => clip.id === event.clipId)) stats.record(event);
   });
   handle("cache-clear", async () => {
      // Rebuilding every thumbnail runs the media tools hard, which must not compete with a game.
      if (captureActive()) throw new Error("Stop capturing before clearing the cache.");
      await clearBrowserCache();
      await collections.clearCache();
      log("maintenance: cache cleared");
   });
   handle("history-clear", async (value) => {
      const parts = historyPartsSchema.parse(value);
      if (parts.stats && collections.root) await stats.clear(collections.root);
      if (parts.logs) await diagnostics.clear();
      log(`maintenance: cleared ${[parts.logs ? "logs" : "", parts.stats ? "usage stats" : ""].filter(Boolean).join(" and ")}`, "warn");
   });
   handle("factory-reset", async (value) => {
      const parts = resetPartsSchema.parse(value);
      const options = {
         type: "warning" as const,
         title: "Factory reset",
         message: "Reset AcroClip?",
         detail: factoryResetDetail(parts),
         buttons: ["Cancel", "Reset and restart"],
         defaultId: 0,
         cancelId: 0,
      };
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const { response } = await (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
      if (response !== 1 || !(await prepareExit())) return false;
      endCaptureSession("exit");
      trackWindow(false);
      await stats.flush();
      quitting = true;
      log(`maintenance: factory reset of ${parts.join(", ")}`, "warn");
      await factoryReset(parts);
      releaseServices();
      // Tests check what the reset left behind. A relaunch would start a second app under them.
      if (process.env["ACROCLIP_TEST"] !== "1") app.relaunch();
      app.quit();
      return true;
   });
   handle("stats-summary", async (from) => {
      const since = z.number().int().min(0).optional().parse(from);
      const events = collections.root ? await stats.read(collections.root) : [];
      return summarizeStats(events, collections.clips, since === undefined ? {} : { from: since });
   });
   handle("diagnostics-error", (value) => {
      const report = rendererErrorSchema.parse(value);
      log(`renderer ${report.kind}: ${report.message}${report.stack ? `\n${report.stack}` : ""}${report.source ? `\n${report.source}` : ""}`, "error");
   });
   handle("logs-export", async () => {
      const picked = await dialog.showSaveDialog({
         title: "Export logs",
         defaultPath: join(exportDirectory(), logArchiveName(new Date())),
         filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      });
      if (picked.canceled || !picked.filePath) return null;
      await writeLogArchive(picked.filePath);
      shell.showItemInFolder(picked.filePath);
      return picked.filePath;
   });
   handle("bug-report", async () => {
      const directory = exportDirectory();
      const path = join(directory, logArchiveName(new Date()));
      await mkdir(directory, { recursive: true });
      await writeLogArchive(path);
      shell.showItemInFolder(path);
      await shell.openExternal(bugReportUrl({ version: app.getVersion(), system: systemDescription(), archive: path.split(/[\\/]/).at(-1)! }));
      return path;
   });
   handle("copy-file", async (path) => {
      const selected = trustedPath(path);
      await copyFileToClipboard(selected);
      await collections.markShared(selected);
      const owner = fileOwner(selected);
      if (owner) stats.record({ type: "copy", ...owner, method: "clipboard" });
   });
   handle("reveal", (path) => {
      const selected = trustedPath(path);
      if (samePath(selected, collections.root)) void shell.openPath(selected);
      else shell.showItemInFolder(selected);
      const owner = fileOwner(selected);
      if (owner) action("reveal", owner.clipId);
   });
   const detectAttaCut = () =>
      findAttaCut(join(app.getPath("userData"), "attacut.json"), {
         platform: process.platform,
         home: app.getPath("home"),
         appData: app.getPath("appData"),
         searchPath: process.env["PATH"] ?? "",
         programFiles: [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter((directory): directory is string => !!directory),
      });
   handle("trim", async (id, start, end, mode) => {
      const clipId = idSchema.parse(id);
      const range = z.object({ start: z.number().finite().min(0), end: z.number().finite().positive() }).parse({ start, end });
      const result = await collections.trimClip(clipId, range.start, range.end, z.enum(["copy", "replace"]).parse(mode), (path) => shell.trashItem(path));
      if (result) action("trim", clipId);
      return result;
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
      action("attacut", clip.id);
   });
   // Envelopes are small and files rarely change during a session, so they stay cached by path and size.
   const loudness = new Map<string, Promise<number[]>>();
   handle("loudness", async (path) => {
      const source = trustedPath(path);
      const key = `${source}:${(await stat(source)).size}`;
      let envelope = loudness.get(key);
      if (!envelope) {
         envelope = probe(source).then((info) => (info.tracks.length ? loudnessEnvelope(source, info.duration) : []));
         envelope.catch(() => loudness.delete(key));
         loudness.set(key, envelope);
      }
      return envelope;
   });
   handle("playback", async (path, track, requestId, options) => {
      const source = trustedPath(path);
      const selection =
         track === undefined ? undefined : z.union([z.number().int().min(0).max(63), z.array(z.number().int().min(0).max(63)).min(1).max(64)]).parse(track);
      const preparation = z.object({ compatible: z.boolean().optional() }).strict().optional().parse(options) ?? {};
      if (requestId === undefined) return collections.playback(source, selection, undefined, preparation);
      const id = z.string().uuid().parse(requestId);
      playbackRequest?.controller.abort();
      const request = { id, controller: new AbortController() };
      playbackRequest = request;
      try {
         return await collections.playback(source, selection, request.controller.signal, preparation);
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
         const selected = trustedPath(path);
         event.sender.startDrag({ file: selected, icon: trayIcon() });
         void collections.markShared(selected).catch(() => undefined);
         const owner = fileOwner(selected);
         if (owner) stats.record({ type: "copy", ...owner, method: "drag" });
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
         void saveClip("command").catch(captureActionError);
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
      } else releaseServices();
   });
   app.on("child-process-gone", (_event, details) => {
      if (details.reason !== "clean-exit")
         log(`${details.type} process gone (${details.reason}, exit code ${details.exitCode}${details.name ? `, ${details.name}` : ""})`, "error");
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
         const previousSession = await diagnostics.begin().catch((): SessionRecord | null => null);
         log(`session: AcroClip ${app.getVersion()} on ${systemDescription()}, Electron ${process.versions.electron}${isPackagedApp() ? "" : ", development"}`);
         if (previousSession && !previousSession.clean)
            log(
               `session: the previous run (${previousSession.version}, started ${new Date(previousSession.startedAt).toISOString()}) did not close cleanly${previousSession.crash ? `: ${previousSession.crash}` : ""}`,
               "warn"
            );
         registerWindowsIdentity(process.execPath);
         if (process.platform === "darwin") app.dock?.setIcon(iconPath());
         preferencePath = join(app.getPath("userData"), "preferences.json");
         preferences = await readPreferences(preferencePath, process.env["ACROCLIP_COLLECTION"] ?? join(app.getPath("videos"), "AcroClip"));
         collectionReady = collections.open(preferences.collection);
         const previewAllowed = () => !!previewSourceId && windowShown() && !closingRequested && !isWaylandSession();
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
                           (!capturing() ||
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
                     log(`Preview source failed: ${errorMessage(error)}`, "warn");
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
               const response = await serveMedia(actual, request);
               response.headers.set("Access-Control-Allow-Origin", "*");
               return response;
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
         if (process.argv.includes("--clip")) void saveClip("command").catch(captureActionError);
         if (preferences.autoRecord && preferences.setupComplete && process.env["ACROCLIP_TEST"] !== "1")
            void startRecording({ quiet: true }).catch(captureActionError);
         // Detection only refreshed the catalogue while it ran, so a machine that never detected a
         // game kept the built-in stand-in. Fetch it once at launch; it then refreshes weekly.
         if (process.env["ACROCLIP_TEST"] !== "1") setTimeout(() => void recorder.gameCatalog().catch(() => undefined), 5000).unref();
         await collectionReady;
         stats.record({
            type: "launch",
            version: app.getVersion(),
            ...(previousSession && previousSession.version !== app.getVersion() ? { previousVersion: previousSession.version } : {}),
            unclean: !!previousSession && !previousSession.clean,
            command: process.argv.includes("--clip"),
         });
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
         log(`startup failed: ${e instanceof Error ? (e.stack ?? e.message) : errorMessage(e)}`, "error");
         void dialog.showMessageBox({ type: "error", message: "AcroClip couldn't start", detail: errorMessage(e) }).then(() => {
            quitting = true;
            app.quit();
         });
      });
}
