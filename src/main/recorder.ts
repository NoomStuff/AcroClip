import { linuxRecorderEnvironment } from "./linux-runtime";
import { selectedCaptureSource } from "../shared/capture-policy";
import { promisify } from "node:util";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { totalmem } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { stoppedRecorder } from "../shared/defaults";
import type {
   AdditionalAudioSource,
   ApplicationArtwork,
   AudioLevels,
   CaptureSource,
   CustomGame,
   GameCandidate,
   Preferences,
   RecorderState,
   RecordingCapabilities,
   SourceKind,
} from "../shared/types";
import { GameCatalog, selectGame } from "./games";
import type { ClipTag } from "../shared/clip-tag";
import { nativeAudioPreferences } from "../shared/audio-model";
import type { AudioFilter } from "../shared/audio-filters";
import { missingAudioWarning, resolveAudioSources } from "./audio-sources";
import { resolveReplayMemoryMB } from "../shared/replay-memory";

export type RecorderErrorContext = "capture" | "save" | "saved-clip";
/** The helper never answered. Unlike a refusal, the request may still complete. */
export class CaptureTimeout extends Error {
   override readonly name = "CaptureTimeout";
}
/** AcroClip closed the helper on purpose, such as to exit or update, while a request was waiting. */
export class CaptureClosed extends Error {
   override readonly name = "CaptureClosed";
}

interface RecorderOptions {
   nativePath?: string;
   gameCatalogPath?: string;
   /** Reaches the app log only: capture still works on the built-in list and added games. */
   onCatalogWarning?: (message: string) => void;
   onState: (state: RecorderState) => void;
   onSaved: (
      file: string,
      source: string,
      requestId: string,
      capture: { previousFootage: boolean; secondsSinceCapture: number; application?: ApplicationArtwork }
   ) => void | Promise<void>;
   onError: (message: string, context: RecorderErrorContext) => void;
   /** A problem worth a line in the app log that changes nothing for the user. */
   onWarning?: (message: string) => void;
   onAudioMonitorError?: (message: string, listeningError?: string) => void;
   onAudioLevels?: (levels: AudioLevels) => void;
   /** The helper's own log (OBS's), for the local recorder log. Never shown to the user. */
   onOutput?: (text: string) => void;
   /** The helper started or ended, for the app log. */
   onLifecycle?: (event: { kind: "started"; executable: string } | { kind: "closed"; code: number | null; signal: string | null; expected: boolean }) => void;
}
interface NativeMessage {
   event: string;
   id?: string;
   message?: string;
   path?: string;
   source?: string;
   requestId?: string;
   active?: boolean;
   availableSeconds?: number;
   pendingSaves?: number;
   windows?: Array<{ name: string; value: string }>;
   fullscreen?: boolean;
   waiting?: boolean;
   action?: string;
   devices?: Array<{ id: string; name: string }>;
   capture?: number;
   microphone?: number;
   additional?: Record<string, unknown>;
   previousFootage?: boolean;
   secondsSinceCapture?: number;
   candidates?: GameCandidate[];
   sourceId?: string;
   sourceKind?: "screen" | "app" | "waiting";
   encoders?: string[];
   captureBackend?: string;
   applicationBackend?: string;
   sourceKinds?: unknown;
   portalPicker?: boolean;
   audioMonitor?: boolean;
   audioListen?: boolean;
   monitorMessage?: string;
   listeningMessage?: string;
   audioWarning?: string;
   historyWarning?: string;
   bufferedSource?: string;
   bufferedSourceId?: string;
   bufferedSourceKind?: "screen" | "app";
}

/** Requests the app repeats on its own. Their errors are never answered by the user. */
const pollActions = new Set(["status", "windows", "candidates", "audio-devices"]);
/** How long one application discovery answers repeated questions. */
const APPLICATION_REUSE_MS = 500;
/** How long the helper may take to exit after every save has finished. */
export const RECORDER_EXIT_TIMEOUT_MS = 5000;

export class Recorder {
   private readonly options: RecorderOptions;
   private process: ChildProcessWithoutNullStreams | null = null;
   private expectedExit = false;
   private timer: ReturnType<typeof setInterval> | null = null;
   private current: RecorderState = { ...stoppedRecorder };
   private windows: Array<{ name: string; value: string }> = [];
   private ready: Promise<void> | null = null;
   private readyResolve: (() => void) | null = null;
   private readyReject: ((reason: Error) => void) | null = null;
   private source = "Screen";
   private pollWarning = "";
   /** Application audio sources that weren't open when capture started. Their tracks stay silent. */
   private missingAudio = "";
   /** Application sources that weren't open when capture started. Windows attaches each once its app opens. */
   private pendingAudio: AdditionalAudioSource[] = [];
   private attachingAudio = false;
   private requests = new Map<string, string>();
   private fullscreen = false;
   private windowsResolve: (() => void) | null = null;
   private devicesResolve: ((devices: Array<{ id: string; name: string }>) => void) | null = null;
   private deviceQueries: Promise<unknown> = Promise.resolve();
   private commands = new Map<
      string,
      { resolve: () => void; reject: (error: Error) => void; onNotAccepted: () => void; timeout: ReturnType<typeof setTimeout> }
   >();
   private readonly catalog: GameCatalog;
   private candidatesPending: Promise<GameCandidate[]> | null = null;
   private applicationsPending: Promise<GameCandidate[]> | null = null;
   private recentApplications: { at: number; items: GameCandidate[] } | null = null;
   private candidatesResolve: ((items: GameCandidate[]) => void) | null = null;
   private autoPreferences: Preferences | null = null;
   private autoSources: CaptureSource[] = [];
   private autoKey = "";
   private autoBusy = false;
   private autoFailure = "";
   private autoGeneration = 0;
   private focused = new Map<string, number>();
   /** The game in front and since when, so capture waits before following a quick alt-tab. */
   private foregroundSince: { id: string; at: number } | undefined;
   private encoders: string[] = [];
   private captureBackend: "wayland-portal" | undefined;
   private applicationBackend: "xwayland" | undefined;
   private sourceKinds: SourceKind[] = ["screen", "app", "auto"];
   private portalPicker = false;
   private audioMonitor = false;
   private audioListen = false;
   private monitorKey = "";
   private requestArtwork = new Map<string, { application: ApplicationArtwork; sourceId: string }>();
   private sourceAudioId: string | null = null;
   private monitorGeneration = 0;
   private monitorLevels: AudioLevels = { capture: 0, microphone: 0 };
   private fastStatusUntil = 0;
   private background = false;
   constructor(options: RecorderOptions) {
      this.options = options;
      this.catalog = new GameCatalog(options.gameCatalogPath ?? path.join(process.cwd(), ".cache", "game-catalog.json"), options.onCatalogWarning);
      this.current.supported =
         (process.platform === "win32" || process.platform === "linux" || process.platform === "darwin") &&
         (existsSync(this.executable) || (!options.nativePath && existsSync(this.developmentExecutable)));
      if (!this.current.supported) this.current.message = "The recorder isn't available in this build";
   }
   private get executable(): string {
      const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      return (
         this.options.nativePath ??
         path.join(resources ?? process.cwd(), "recorder", process.platform === "win32" ? "acroclip-recorder.exe" : "acroclip-recorder")
      );
   }
   private get developmentExecutable(): string {
      return path.join(process.cwd(), "resources", "recorder", process.platform === "win32" ? "acroclip-recorder.exe" : "acroclip-recorder");
   }
   get status(): RecorderState {
      return { ...this.current };
   }
   updatePreferences(preferences: Preferences): void {
      if (this.autoPreferences && preferences.sourceKind === "auto") this.autoPreferences = preferences;
   }
   /** While AcroClip is in the background, status and game checks run every 2 s instead of every second. */
   setBackground(background: boolean): void {
      this.background = background;
   }
   async foregroundFullscreen(): Promise<boolean> {
      this.poll();
      return this.fullscreen;
   }
   async audioDevices(kind: "input" | "output" = "input"): Promise<Array<{ id: string; name: string }>> {
      if (!this.current.supported) return [];
      await this.initialize();
      const query = this.deviceQueries
         .catch(() => undefined)
         .then(
            () =>
               new Promise<Array<{ id: string; name: string }>>((resolve) => {
                  const timeout = setTimeout(() => {
                     this.devicesResolve = null;
                     resolve([]);
                  }, 3000);
                  this.devicesResolve = (devices) => {
                     clearTimeout(timeout);
                     resolve(devices);
                  };
                  this.send({ action: "audio-devices", kind });
               })
         );
      this.deviceQueries = query;
      return query;
   }
   async capabilities(): Promise<RecordingCapabilities> {
      if (!this.current.supported)
         return { supported: false, hardwareEncoders: [], recommended: "standard", message: "The recorder is missing from this build." };
      try {
         await this.initialize();
         const hardwareEncoders = [...this.encoders];
         return {
            supported: true,
            hardwareEncoders,
            recommended: hardwareEncoders.length ? "standard" : "low",
            message: hardwareEncoders.length ? "" : "No supported hardware encoder was found. Software encoding uses your CPU.",
            sourceKinds: [...this.sourceKinds],
            portalPicker: this.portalPicker,
            memoryBytes: totalmem(),
            ...(this.captureBackend ? { captureBackend: this.captureBackend } : {}),
            ...(this.applicationBackend ? { applicationBackend: this.applicationBackend } : {}),
         };
      } catch (failure) {
         return {
            supported: false,
            hardwareEncoders: [],
            recommended: "standard",
            message: failure instanceof Error ? failure.message : "The recorder couldn't start.",
         };
      }
   }
   /**
    * The full catalogue for the Games page. Until one has been downloaded only the short built-in
    * list exists, so that case waits for the download instead of showing the stand-in.
    */
   async gameCatalog() {
      const listed = await this.catalog.list();
      if (listed.source === "built-in") await this.catalog.refresh();
      else void this.catalog.refresh();
      return this.catalog.list();
   }
   async games(additions: CustomGame[] = []): Promise<GameCandidate[]> {
      if (!this.current.supported) return [];
      await this.catalog.load();
      void this.catalog.refresh();
      const candidates = (await this.capturableApplications()).filter((candidate) => candidate.pid !== process.pid);
      const games = this.catalog.match(candidates, additions);
      return candidates.map((candidate) => {
         const game = games.find((item) => item.id === candidate.id);
         return game ? { ...candidate, gameId: game.gameId, gameName: game.gameName } : candidate;
      });
   }
   /** Adds the catalog game to each recognized window, so clips can follow the game rather than its install path. */
   async identifyGames(candidates: GameCandidate[]): Promise<GameCandidate[]> {
      await this.catalog.load();
      const games = this.catalog.match(candidates, []);
      return candidates.map((candidate) => {
         const game = games.find((item) => item.id === candidate.id);
         return game ? { ...candidate, gameId: game.gameId, gameName: game.gameName } : candidate;
      });
   }
   async capturableApplications(): Promise<GameCandidate[]> {
      // Auto capture and the open Capture page both ask every second. Discovery
      // spawns a helper on Windows, so they share one result for a moment.
      if (this.recentApplications && Date.now() - this.recentApplications.at < APPLICATION_REUSE_MS) return this.recentApplications.items;
      if (this.applicationsPending) return this.applicationsPending;
      this.applicationsPending = (async () => {
         for (let attempt = 0; ; attempt++) {
            try {
               const items = await this.queryApplications();
               this.recentApplications = { at: Date.now(), items };
               return items;
            } catch (error) {
               if (attempt === 2) throw error;
               await new Promise<void>((resolve) => setTimeout(resolve, attempt === 0 ? 150 : 450));
            }
         }
      })().finally(() => {
         this.applicationsPending = null;
      });
      return this.applicationsPending;
   }
   private async queryApplications(): Promise<GameCandidate[]> {
      if (!this.current.supported) return [];
      if (process.platform === "win32") {
         // Discovery must not wait behind capture startup or audio commands.
         const executable = existsSync(this.executable) ? this.executable : this.developmentExecutable;
         try {
            const { stdout } = await promisify(execFile)(executable, [path.dirname(executable), "--candidates"], {
               windowsHide: true,
               timeout: 5000,
               maxBuffer: 2 * 1024 * 1024,
            });
            const parsed: unknown = JSON.parse(stdout);
            return parsed && typeof parsed === "object" && "windows" in parsed && Array.isArray(parsed.windows)
               ? parsed.windows.filter(
                    (item): item is GameCandidate =>
                       !!item && typeof item === "object" && typeof item.id === "string" && typeof item.pid === "number" && typeof item.name === "string"
                 )
               : [];
         } catch {
            throw new Error("Couldn't list open apps. Refresh to try again.");
         }
      }
      await this.initialize();
      return this.candidates();
   }
   async applicationCandidates(): Promise<GameCandidate[]> {
      if (!this.current.supported) return [];
      return (await this.capturableApplications()).filter((candidate) => candidate.pid !== process.pid);
   }
   private candidates(): Promise<GameCandidate[]> {
      if (this.candidatesPending) return this.candidatesPending;
      this.candidatesPending = new Promise<GameCandidate[]>((resolve, reject) => {
         const timeout = setTimeout(() => {
            this.candidatesResolve = null;
            reject(new Error("Finding open apps took too long. Refresh the source list."));
         }, 3000);
         this.candidatesResolve = (items) => {
            clearTimeout(timeout);
            resolve(items);
         };
         this.send({ action: "candidates" });
      }).finally(() => {
         this.candidatesPending = null;
      });
      return this.candidatesPending;
   }
   private async autoConfiguration(preferences: Preferences, sources: CaptureSource[]): Promise<Record<string, unknown>> {
      await this.catalog.load();
      void this.catalog.refresh();
      const candidates = (await this.capturableApplications()).filter((candidate) => candidate.pid !== process.pid);
      const games = this.catalog.match(candidates, preferences.customGames);
      for (const game of games) if (game.foreground) this.focused.set(game.id, Date.now());
      const foreground = games.find((game) => game.foreground);
      if (foreground?.id !== this.foregroundSince?.id) this.foregroundSince = foreground ? { id: foreground.id, at: Date.now() } : undefined;
      const selected = selectGame(games, this.current.sourceKind === "app" ? (this.current.sourceId ?? null) : null, this.focused, this.foregroundSince);
      if (selected)
         return {
            ...nativeAudioPreferences(preferences),
            resolvedKind: "app",
            sourceId: selected.id,
            sourceName: selected.gameName,
            pid: selected.pid,
            pixelSize: selected.pixelSize,
            preferGameCapture: true,
         };
      if (preferences.desktopFallback) {
         const screen =
            sources.find((item) => item.kind === "screen" && item.id === preferences.sourceId) ??
            (!preferences.sourceId ? sources.find((item) => item.kind === "screen") : undefined);
         if (screen)
            return {
               ...nativeAudioPreferences(preferences),
               resolvedKind: "screen",
               sourceId: screen.id,
               sourceName: "Desktop",
               bounds: screen.bounds,
               displayId: screen.displayId,
               screenIndex: sources.filter((item) => item.kind === "screen").findIndex((item) => item.id === screen.id),
            };
      }
      return { ...nativeAudioPreferences(preferences), resolvedKind: "waiting", sourceId: "", sourceName: "Waiting for game" };
   }
   private async followGame(): Promise<void> {
      if (this.autoBusy || !this.autoPreferences || !["recording", "waiting"].includes(this.current.state)) return;
      const generation = this.autoGeneration;
      this.autoBusy = true;
      try {
         const configuration = await this.autoConfiguration(this.autoPreferences, this.autoSources);
         if (generation !== this.autoGeneration) return;
         const key = this.configurationKey(configuration);
         if (key !== this.autoKey) {
            this.fastStatusUntil = Date.now() + 8000;
            await this.command({ action: "source", ...configuration });
            if (generation === this.autoGeneration) this.autoKey = key;
         }
         if (generation === this.autoGeneration) this.autoFailure = "";
      } catch (error) {
         if (generation === this.autoGeneration) this.autoFailure = error instanceof Error ? error.message : "Waiting for game";
      } finally {
         this.autoBusy = false;
      }
   }
   /**
    * Gives a silent application track its audio once the app opens, without restarting capture. Only
    * runs while a source is still waiting, so it costs nothing otherwise. A source the helper refuses
    * stays silent for the rest of the session instead of being retried every tick.
    */
   private async attachPendingAudio(): Promise<void> {
      if (this.attachingAudio || !this.pendingAudio.length || process.platform !== "win32" || !["recording", "waiting"].includes(this.current.state)) return;
      this.attachingAudio = true;
      try {
         const { sources } = resolveAudioSources(this.pendingAudio, await this.capturableApplications());
         for (const source of sources.filter((item) => item.enabled)) {
            this.pendingAudio = this.pendingAudio.filter((item) => item.id !== source.id);
            try {
               await this.command({ action: "attach-audio", settings: source });
            } catch (error) {
               this.options.onWarning?.(`${source.name} opened, but its audio couldn't be added: ${error instanceof Error ? error.message : String(error)}`);
            }
         }
         // The next status report carries the shorter list.
         this.missingAudio = missingAudioWarning(
            this.pendingAudio.map((source) => source.name),
            true
         );
      } catch {
         /* Discovery failing just waits for the next tick. */
      } finally {
         this.attachingAudio = false;
      }
   }
   private configurationKey(configuration: Record<string, unknown>): string {
      return `${configuration["resolvedKind"]}:${configuration["sourceId"]}:${configuration["pid"] ?? ""}`;
   }
   private update(value: Partial<RecorderState>): void {
      this.current = { ...this.current, ...value };
      this.options.onState(this.status);
   }
   private error(message: string, context: RecorderErrorContext = "capture"): void {
      this.options.onError(message, context);
   }
   /**
    * Asks for status without expecting an answer. A timer can fire while the helper exits, and a
    * throw from a timer would crash the app, so a closed pipe just skips this poll.
    */
   private poll(): void {
      if (this.process?.stdin.writable) this.send({ action: "status" });
   }
   private send(value: Record<string, unknown>): void {
      if (!this.process?.stdin.writable) throw new Error("Capture isn't running. Start capturing and try again.");
      this.process.stdin.write(`${JSON.stringify(value)}\n`);
   }
   /** Answers every waiting request once the helper is gone. */
   private rejectCommands(): void {
      for (const command of this.commands.values()) {
         clearTimeout(command.timeout);
         command.reject(this.expectedExit ? new CaptureClosed("Capture closed before this finished.") : new Error("Capture stopped unexpectedly."));
      }
      this.commands.clear();
   }
   private command(value: Record<string, unknown>, onNotAccepted: () => void = () => undefined): Promise<void> {
      const id = randomUUID();
      return new Promise((resolve, reject) => {
         const timeout = setTimeout(() => {
            this.commands.delete(id);
            reject(new CaptureTimeout("Capture didn't respond in time."));
         }, 20_000);
         this.commands.set(id, { resolve, reject, timeout, onNotAccepted });
         try {
            this.send({ ...value, id });
         } catch (error) {
            clearTimeout(timeout);
            this.commands.delete(id);
            onNotAccepted();
            reject(error instanceof Error ? error : new Error("Capture stopped responding."));
         }
      });
   }
   private async initialize(): Promise<void> {
      if (this.ready) return this.ready;
      let executable = this.executable;
      // Unpackaged development uses the same staged runtime as packaged builds.
      if (!existsSync(executable) && !this.options.nativePath) executable = this.developmentExecutable;
      if ((process.platform !== "win32" && process.platform !== "linux" && process.platform !== "darwin") || !existsSync(executable))
         throw new Error("Capture isn't supported on this system yet.");
      const root = path.dirname(executable);
      this.expectedExit = false;
      const child = spawn(executable, [root], {
         cwd: root,
         windowsHide: true,
         stdio: "pipe",
         env: process.platform === "linux" ? linuxRecorderEnvironment(root) : process.env,
      });
      this.process = child;
      this.options.onLifecycle?.({ kind: "started", executable });
      this.ready = new Promise<void>((resolve, reject) => {
         this.readyResolve = resolve;
         this.readyReject = reject;
      });
      const ready = this.ready;
      child.stdin.on("error", (error: Error) => {
         this.readyReject?.(error);
         this.rejectCommands();
         // A write racing a deliberate exit or kill breaks the pipe; that is not a capture failure.
         if (!this.expectedExit) this.error("Capture stopped unexpectedly.");
      });
      createInterface({ input: child.stdout }).on("line", (line: string) => {
         try {
            const value: unknown = JSON.parse(line);
            if (value && typeof value === "object" && "event" in value && typeof value.event === "string") this.message(value as NativeMessage);
         } catch {
            this.error("Capture stopped unexpectedly.");
         }
      });
      // Diagnostic text remains local and is never forwarded as user-facing errors.
      let testDiagnostics = "";
      child.stderr.on("data", (data: Buffer) => {
         this.options.onOutput?.(data.toString("utf8"));
         if (process.env["ACROCLIP_TEST"] === "1") testDiagnostics = (testDiagnostics + data.toString("utf8")).slice(-16000);
         if (process.env["ACROCLIP_TEST"] === "1" && this.expectedExit) console.log(`Test shutdown: native ${data.toString("utf8").slice(-8000)}`);
      });
      child.on("error", (error) => {
         this.readyReject?.(error);
         this.update({ state: "error", message: error.message });
         this.error(error.message);
      });
      // Failed launches emit close without exit. Close also follows drained stdout,
      // so buffered save responses are handled before termination clears requests.
      const closed = new Promise<void>((resolve) =>
         child.once("close", (code, signal) => {
            if (process.env["ACROCLIP_TEST"] === "1") console.log(`Test native: closed with code ${code}, signal ${signal}\n${testDiagnostics}`);
            this.options.onLifecycle?.({ kind: "closed", code, signal, expected: this.expectedExit });
            this.readyReject?.(new Error("Capture couldn't start. Try again, or restart AcroClip."));
            this.readyResolve = null;
            this.readyReject = null;
            this.process = null;
            this.ready = null;
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            this.autoPreferences = null;
            this.autoGeneration++;
            this.candidatesResolve?.([]);
            this.candidatesResolve = null;
            this.devicesResolve?.([]);
            this.devicesResolve = null;
            this.windowsResolve?.();
            this.windowsResolve = null;
            this.windows = [];
            this.fullscreen = false;
            this.monitorKey = "";
            this.monitorGeneration++;
            const unexpected = !this.expectedExit && (this.current.state !== "stopped" || this.requests.size > 0);
            const message = unexpected
               ? this.current.state === "error" && this.current.message
                  ? this.current.message
                  : `Capture stopped unexpectedly.${code ? ` The recorder exited with code ${code}.` : ""}`
               : "";
            if (unexpected && this.current.state !== "error") this.error(message);
            this.requests.clear();
            this.requestArtwork.clear();
            this.rejectCommands();
            this.update({ state: unexpected ? "error" : "stopped", message, availableSeconds: 0, startedAt: null, pendingSaves: 0 });
            resolve();
         })
      );
      const timeout = setTimeout(() => {
         this.readyReject?.(new Error("Capture took too long to start."));
         child.kill();
      }, 20_000);
      try {
         await ready;
      } catch (error) {
         child.kill();
         await closed;
         throw error;
      } finally {
         clearTimeout(timeout);
      }
      await this.refreshWindows();
      // Status polls also advance the native canvas fit. Poll quickly while a
      // source is starting so footage begins sooner, then settle to once a second.
      // In the background the steady rate halves, so a running game keeps the machine.
      let tick = 0;
      this.timer = setInterval(() => {
         const steady = tick++ % (this.background ? 8 : 4) === 0;
         if (steady || Date.now() < this.fastStatusUntil) this.poll();
         if (steady) void this.followGame();
         if (steady) void this.attachPendingAudio();
      }, 250);
   }
   private message(value: NativeMessage): void {
      if (value.id && (value.event === "response" || value.event === "error")) {
         const command = this.commands.get(value.id);
         if (command) {
            clearTimeout(command.timeout);
            this.commands.delete(value.id);
            if (value.event === "error") {
               command.onNotAccepted();
               command.reject(new Error(value.message ?? "Capture action failed"));
               // The caller owns command failures. Monitor setup and rejected
               // source switches must not turn a healthy recording into an error.
               return;
            } else command.resolve();
         }
      }
      if (value.event === "ready") {
         this.audioMonitor = value.audioMonitor === true;
         this.audioListen = value.audioListen === true;
         this.current.supported = true;
         this.encoders = Array.isArray(value.encoders) ? value.encoders.filter((value) => typeof value === "string" && value.length < 200) : [];
         this.captureBackend = value.captureBackend === "wayland-portal" ? "wayland-portal" : undefined;
         this.applicationBackend = this.captureBackend && value.applicationBackend === "xwayland" ? "xwayland" : undefined;
         this.sourceKinds = Array.isArray(value.sourceKinds)
            ? value.sourceKinds.filter((kind): kind is SourceKind => kind === "screen" || kind === "app" || kind === "auto")
            : this.captureBackend
              ? ["screen"]
              : ["screen", "app", "auto"];
         if (this.captureBackend && !this.applicationBackend) this.sourceKinds = this.sourceKinds.filter((kind) => kind === "screen");
         this.portalPicker = value.portalPicker === true;
         this.readyResolve?.();
         this.readyResolve = null;
         this.readyReject = null;
      }
      if (value.event === "windows" && Array.isArray(value.windows)) {
         this.windows = value.windows;
         this.windowsResolve?.();
         this.windowsResolve = null;
      }
      const candidates: unknown = value.candidates ?? value.windows;
      if (value.event === "candidates" && Array.isArray(candidates)) {
         this.candidatesResolve?.(
            candidates.filter(
               (item: unknown): item is GameCandidate =>
                  !!item &&
                  typeof item === "object" &&
                  "id" in item &&
                  typeof item.id === "string" &&
                  "name" in item &&
                  typeof item.name === "string" &&
                  "executable" in item &&
                  typeof item.executable === "string" &&
                  "pid" in item &&
                  Number.isSafeInteger(item.pid) &&
                  "foreground" in item &&
                  typeof item.foreground === "boolean" &&
                  "fullscreen" in item &&
                  typeof item.fullscreen === "boolean"
            )
         );
         this.candidatesResolve = null;
      }
      if (value.event === "audio-devices" && Array.isArray(value.devices)) {
         this.devicesResolve?.(value.devices.filter((device) => typeof device.id === "string" && typeof device.name === "string"));
         this.devicesResolve = null;
      }
      if (value.event === "audio-levels") {
         const idle = !["starting", "recording", "waiting"].includes(this.current.state);
         if (idle) {
            if (typeof value.additional?.["monitor-capture"] === "number") this.monitorLevels.capture = value.additional["monitor-capture"];
            if (typeof value.additional?.["monitor-microphone"] === "number") this.monitorLevels.microphone = value.additional["monitor-microphone"];
         }
         this.options.onAudioLevels?.({
            capture: idle ? this.monitorLevels.capture : Number.isFinite(value.capture) ? Math.max(0, Math.min(1, value.capture!)) : 0,
            microphone: idle ? this.monitorLevels.microphone : Number.isFinite(value.microphone) ? Math.max(0, Math.min(1, value.microphone!)) : 0,
            ...(value.additional && typeof value.additional === "object" && !Array.isArray(value.additional)
               ? {
                    additional: Object.fromEntries(
                       Object.entries(value.additional)
                          .filter(([id, level]) => id.length <= 200 && typeof level === "number" && Number.isFinite(level))
                          .map(([id, level]) => [id, Math.max(0, Math.min(1, level as number))])
                    ),
                 }
               : {}),
         });
      }
      if (value.event === "recording")
         this.update({
            state: "recording",
            startedAt: Date.now(),
            availableSeconds: 0,
            message: "",
            supported: true,
            audioWarning: "",
            historyWarning: "",
            bufferedSourceName: "",
            bufferedSourceId: "",
         });
      if (value.event === "stopped")
         this.update({
            state: "stopped",
            startedAt: null,
            availableSeconds: 0,
            message: "",
            audioWarning: "",
            historyWarning: "",
            bufferedSourceName: "",
            bufferedSourceId: "",
         });
      if (value.event === "audio-monitor") this.options.onAudioMonitorError?.(value.monitorMessage ?? "", value.listeningMessage ?? "");
      if (value.event === "status") {
         if (typeof value.monitorMessage === "string") this.options.onAudioMonitorError?.(value.monitorMessage, value.listeningMessage ?? "");
         this.fullscreen = value.fullscreen === true;
         this.update({
            foregroundFullscreen: this.fullscreen,
            ...(value.active && this.current.state !== "error"
               ? {
                    state: value.waiting ? ("waiting" as const) : ("recording" as const),
                    message: value.waiting
                       ? // The helper's default waiting text names a game, which is wrong for a chosen application.
                         (value.message && (this.autoPreferences || value.message !== "Waiting for game") ? value.message : "") ||
                         this.autoFailure ||
                         (this.autoPreferences ? "Waiting for game" : value.sourceKind === "screen" ? "Waiting for the screen" : "Waiting for application")
                       : this.autoFailure
                         ? `Capturing current source. ${this.autoFailure}`
                         : value.sourceKind === "screen" && this.autoPreferences
                           ? "Capturing screen fallback"
                           : "",
                 }
               : {}),
            availableSeconds: Number.isFinite(value.availableSeconds) ? value.availableSeconds! : 0,
            pendingSaves: this.requests.size,
            ...(value.sourceId !== undefined ? { sourceId: value.sourceId } : {}),
            ...(value.source !== undefined ? { sourceName: value.source } : {}),
            ...(value.sourceKind !== undefined ? { sourceKind: value.sourceKind } : {}),
            ...(value.audioWarning !== undefined ? { audioWarning: value.audioWarning || this.missingAudio } : {}),
            ...(value.historyWarning !== undefined ? { historyWarning: value.historyWarning } : {}),
            ...(value.bufferedSource !== undefined ? { bufferedSourceName: value.bufferedSource } : {}),
            ...(value.bufferedSourceId !== undefined ? { bufferedSourceId: value.bufferedSourceId } : {}),
            ...(value.bufferedSourceKind !== undefined ? { bufferedSourceKind: value.bufferedSourceKind } : {}),
         });
      }
      if (value.event === "saved" && value.path) {
         const savedPath = value.path;
         void (async () => {
            await this.options.onSaved(savedPath, value.source ?? this.source, value.requestId ?? "", {
               previousFootage: value.previousFootage ?? false,
               secondsSinceCapture: value.secondsSinceCapture ?? 0,
               ...(value.requestId &&
               this.requestArtwork.has(value.requestId) &&
               (value.sourceId === undefined || value.sourceId === this.requestArtwork.get(value.requestId)!.sourceId)
                  ? { application: this.requestArtwork.get(value.requestId)!.application }
                  : {}),
            });
         })()
            .catch((error: unknown) => this.error(error instanceof Error ? error.message : "Couldn't add the saved clip to the library", "saved-clip"))
            .finally(() => {
               if (value.requestId) {
                  this.requests.delete(value.requestId);
                  this.requestArtwork.delete(value.requestId);
               }
               this.update({ pendingSaves: this.requests.size });
            });
      }
      // Status polls and queries carry no command id. Their next answer reports the real state, so a
      // failure in one, like a source that closed between polls, is not a capture failure.
      if (value.event === "error" && !value.id && !value.requestId && value.action && pollActions.has(value.action)) {
         const warning = `${value.action}: ${value.message ?? "failed"}`;
         // A poll repeats every second. The log keeps one line per new problem.
         if (warning !== this.pollWarning) this.options.onWarning?.(warning);
         this.pollWarning = warning;
         return;
      }
      if (value.event === "status") this.pollWarning = "";
      if (value.event === "error") {
         if (value.requestId) {
            this.requests.delete(value.requestId);
            this.requestArtwork.delete(value.requestId);
         } else if (this.current.state === "starting") this.update({ state: "error", startedAt: null, message: value.message ?? "Capture couldn't start" });
         this.update({ pendingSaves: this.requests.size });
         this.error(value.message ?? "Capture failed", value.requestId ? "save" : "capture");
      }
      if (value.event === "fatal") {
         this.update({ state: "error", message: value.message ?? "Capture stopped unexpectedly" });
         this.error(this.current.message);
      }
   }
   private async refreshWindows(): Promise<void> {
      await new Promise<void>((resolve) => {
         const timeout = setTimeout(() => {
            this.windowsResolve = null;
            resolve();
         }, 2000);
         this.windowsResolve = () => {
            clearTimeout(timeout);
            resolve();
         };
         this.send({ action: "windows" });
      });
   }
   private async configuration(preferences: Preferences, sources: CaptureSource[]): Promise<Record<string, unknown>> {
      this.sourceAudioId = preferences.audioSources.find((source) => source.kind === "source")?.id ?? null;
      if (!this.sourceKinds.includes(preferences.sourceKind))
         throw new Error("Application and Auto capture are unavailable in this Wayland session. Choose Screen to use the system picker.");
      if (preferences.sourceKind === "auto") return this.autoConfiguration(preferences, sources);
      const selected = selectedCaptureSource(sources, preferences);
      if (!selected) throw new Error("The selected source is gone. Choose another one.");
      this.source = selected.kind === "screen" ? "Desktop" : (selected.applicationName ?? selected.name);
      const screenIndex = sources.filter((s) => s.kind === "screen").findIndex((s) => s.id === selected.id);
      // Match OBS's available window list rather than inventing an executable identity.
      const window = this.windows.find((w) => w.value.split(":")[0] === selected.name || w.name.endsWith(`: ${selected.name}`));
      if (preferences.sourceKind === "app" && !selected.id.startsWith("window:"))
         throw new Error("This app can't be captured on its own. Choose Screen instead.");
      return {
         ...nativeAudioPreferences(preferences),
         pixelSize: selected.pixelSize,
         sourceName: this.source,
         displayId: selected.displayId,
         screenIndex: Math.max(0, screenIndex),
         bounds: selected.bounds,
         window: window?.value ?? "",
      };
   }
   async listenAudio(source: string | null, deviceId = "default"): Promise<void> {
      if (source && source === this.sourceAudioId) source = "capture";
      if (!source) {
         if (this.process) await this.command({ action: "listen-audio", source: "" });
         return;
      }
      if (this.current.state === "starting") throw new Error("Wait for capturing to start before listening.");
      await this.initialize();
      if (!this.audioListen) throw new Error("Restart AcroClip to enable source listening.");
      await this.command({
         action: "listen-audio",
         source: !["recording", "waiting"].includes(this.current.state) && ["capture", "microphone"].includes(source) ? `monitor-${source}` : source,
         deviceId,
      });
   }
   async monitorAudio(preferences: Preferences | null): Promise<string[]> {
      const generation = ++this.monitorGeneration;
      try {
         // Without a recorder the status bar already says so; a monitor error would repeat it.
         if (!this.current.supported || ["starting", "recording", "waiting"].includes(this.current.state)) return [];
         if (!preferences) {
            this.monitorKey = "";
            this.monitorLevels = { capture: 0, microphone: 0 };
            if (this.process && this.audioMonitor) await this.command({ action: "monitor-audio", enabled: false });
            return [];
         }
         this.sourceAudioId = preferences.audioSources.find((source) => source.kind === "source")?.id ?? null;
         const audio = nativeAudioPreferences(preferences);
         await this.initialize();
         if (!this.audioMonitor) throw new Error("Restart AcroClip to enable audio monitoring.");
         const candidates = await this.applicationCandidates();
         // An application that isn't open has nothing to meter. The rest still move.
         const sources: Array<Record<string, unknown>> = resolveAudioSources(
            audio.audioSources.filter((source) => source.enabled),
            candidates
         )
            .sources.filter((source) => source.enabled)
            .map((source) => ({ ...source }));
         if (audio.microphone)
            sources.push({
               id: "monitor-microphone",
               name: "Microphone",
               kind: "input",
               deviceId: audio.microphoneDevice || "default",
               volume: audio.microphoneVolume,
               muted: audio.microphoneMuted,
            });
         if (audio.captureAudio) {
            if (preferences.sourceKind === "auto") await this.catalog.load();
            const target =
               preferences.sourceKind === "app" && preferences.sourceId.startsWith("window:")
                  ? candidates.find((item) => item.id.split(":")[1] === preferences.sourceId.split(":")[1])
                  : preferences.sourceKind === "auto"
                    ? selectGame(this.catalog.match(candidates, preferences.customGames), null, this.focused)
                    : undefined;
            // A chosen app that isn't open has no audio to meter. The other sources still move.
            if (target)
               sources.push({
                  id: "monitor-capture",
                  name: "Source audio",
                  kind: "application",
                  sourceId: target.id,
                  pid: target.pid,
                  volume: audio.captureVolume,
                  muted: audio.captureMuted,
                  filters: audio.captureFilters,
               });
            else if (preferences.sourceKind === "screen" || (preferences.sourceKind === "auto" && preferences.desktopFallback))
               sources.push({
                  id: "monitor-capture",
                  name: "Source audio",
                  kind: "output",
                  deviceId: process.platform === "darwin" ? "system" : "default",
                  volume: audio.captureVolume,
                  muted: audio.captureMuted,
                  filters: audio.captureFilters,
               });
         }
         const live = new Set(["volume", "muted", "filters"]);
         const key = JSON.stringify(sources.map((source) => Object.fromEntries(Object.entries(source).filter(([key]) => !live.has(key)))));
         if (["starting", "recording", "waiting"].includes(this.current.state)) return [];
         if (generation !== this.monitorGeneration) return [];
         if (key !== this.monitorKey) {
            this.monitorKey = "";
            this.monitorLevels = { capture: 0, microphone: 0 };
            await this.command({ action: "monitor-audio", enabled: true, audioSources: sources, applicationPid: process.pid });
            if (generation !== this.monitorGeneration) return [];
            this.monitorKey = key;
         } else
            for (const source of sources)
               await this.command({
                  action: "audio",
                  source: source["id"],
                  volume: source["volume"],
                  muted: source["muted"],
                  filters: source["filters"] ?? [],
               });
         return sources.map((source) => String(source["id"]).replace("monitor-", ""));
      } catch (error) {
         if (generation === this.monitorGeneration && !["starting", "recording", "waiting"].includes(this.current.state)) {
            this.monitorKey = "";
            this.monitorLevels = { capture: 0, microphone: 0 };
            if (this.process && this.audioMonitor) await this.command({ action: "monitor-audio", enabled: false }).catch(() => undefined);
         }
         throw error;
      }
   }
   async start(preferences: Preferences, sources: CaptureSource[] = []): Promise<void> {
      this.autoFailure = "";
      this.missingAudio = "";
      this.pendingAudio = [];
      this.monitorGeneration++;
      this.monitorKey = "";
      this.monitorLevels = { capture: 0, microphone: 0 };
      this.update({ state: "starting", message: "Starting capture" });
      try {
         await this.initialize();
         const configuration = await this.configuration(preferences, sources);
         const audio = resolveAudioSources(
            nativeAudioPreferences(preferences).audioSources,
            preferences.audioSources.some((source) => source.enabled && source.kind === "application") ? await this.capturableApplications() : []
         );
         configuration["audioSources"] = audio.sources;
         this.missingAudio = missingAudioWarning(audio.missing, process.platform === "win32");
         const silent = new Set(audio.sources.filter((source) => !source.enabled).map((source) => source.id));
         this.pendingAudio = nativeAudioPreferences(preferences).audioSources.filter(
            (source) => source.enabled && source.kind === "application" && silent.has(source.id)
         );
         this.fastStatusUntil = Date.now() + 8000;
         await this.command({
            action: "start",
            ...configuration,
            replayMemoryMB: resolveReplayMemoryMB(preferences.replayMemoryMB, totalmem()),
            applicationPid: process.pid,
         });
         this.autoGeneration++;
         this.autoPreferences = preferences.sourceKind === "auto" ? preferences : null;
         this.autoSources = sources;
         this.autoKey = this.configurationKey(configuration);
      } catch (error) {
         this.update({ state: "error", message: error instanceof Error ? error.message : "Capture couldn't start" });
         throw error;
      }
   }
   async stop(): Promise<void> {
      this.autoFailure = "";
      this.autoPreferences = null;
      this.autoGeneration++;
      if (this.process) await this.command({ action: "stop" });
   }
   async setAudio(value: { source: string; volume: number; muted: boolean; filters: AudioFilter[] }): Promise<void> {
      if (value.source === this.sourceAudioId) value = { ...value, source: "capture" };
      if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 4) throw new Error("Audio volume must be between 0 and 400 percent");
      if (this.process) await this.command({ action: "audio", ...value });
   }
   async switchSource(preferences: Preferences, sources: CaptureSource[] = []): Promise<void> {
      this.autoFailure = "";
      if (this.process) {
         this.autoPreferences = null;
         this.autoGeneration++;
         await this.refreshWindows();
         const configuration = await this.configuration(preferences, sources);
         this.fastStatusUntil = Date.now() + 8000;
         await this.command({ action: "source", ...configuration });
         this.autoPreferences = preferences.sourceKind === "auto" ? preferences : null;
         this.autoSources = sources;
         this.autoKey = this.configurationKey(configuration);
      }
   }
   get pendingSavePaths(): readonly string[] {
      return [...this.requests.values()];
   }
   async save(file?: string, requestedAt = Date.now(), application?: ApplicationArtwork): Promise<void> {
      if (this.current.state !== "recording" && this.current.state !== "waiting") throw new Error("Start capturing before saving a clip");
      if (!file) throw new Error("A destination path is required for the clip");
      const requestId = randomUUID();
      this.requests.set(requestId, file);
      const sourceId = this.current.bufferedSourceId || this.current.sourceId || "";
      if (application) this.requestArtwork.set(requestId, { application, sourceId });
      this.update({ pendingSaves: this.requests.size });
      // The recorder adds the footage's source name and drops the application if the footage predates it.
      const tag = {
         version: 1,
         savedAt: Math.round(requestedAt),
         ...(application ? { application: { id: application.id, ...(application.name ? { name: application.name } : {}) } } : {}),
         sourceId,
      } satisfies ClipTag & { sourceId: string };
      const command = { action: "save", path: file, requestId, requestedAt, requestAgeMs: Math.max(0, Date.now() - requestedAt), tag: JSON.stringify(tag) };
      await this.command(command, () => {
         this.requests.delete(requestId);
         this.requestArtwork.delete(requestId);
         this.update({ pendingSaves: this.requests.size });
      });
   }
   async close(options: { cancel?: boolean } = {}): Promise<void> {
      this.autoPreferences = null;
      this.autoGeneration++;
      if (!this.process) return;
      const child = this.process;
      const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
      if (options.cancel) {
         this.expectedExit = true;
         child.kill();
         await exited;
         return;
      }
      if (!child.pid || child.exitCode !== null || child.signalCode !== null || !child.stdin.writable) {
         await exited;
         return;
      }
      // Stopping drains saves still waiting for their footage. With none, the helper can exit as it is.
      if (this.requests.size) this.send({ action: "stop" });
      while (this.requests.size && this.process) await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (this.process) {
         this.expectedExit = true;
         this.send({ action: "exit" });
      }
      // Every requested save has finished by now. A helper that hangs while
      // releasing devices must not hold the app (or an update) open indefinitely.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
         exited.then(() => true),
         new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), RECORDER_EXIT_TIMEOUT_MS);
         }),
      ]);
      clearTimeout(timer);
      if (!settled) {
         child.kill();
         await exited;
      }
   }
}
