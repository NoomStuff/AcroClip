import type { ShortcutBindings } from "./shortcuts";
export type SourceKind = "screen" | "app" | "auto";
export interface ApplicationArtwork {
   id: string;
   icon: string;
}
export interface CaptureSource {
   applicationId?: string;
   appIcon?: string;
   id: string;
   name: string;
   kind: "screen" | "app";
   thumbnail: string;
   pixelSize?: { width: number; height: number };
   processId?: number;
   displayId?: string;
   bounds?: { x: number; y: number; width: number; height: number };
}
export interface GameCandidate {
   id: string;
   name: string;
   executable: string;
   pid: number;
   pixelSize?: { width: number; height: number };
   foreground: boolean;
   fullscreen: boolean;
   arguments?: string;
   runtime?: "wine";
   runtimeExecutable?: string;
   gameName?: string;
}
export interface GameCatalogSnapshot {
   source: "saved" | "built-in";
   entries: Array<{ id: string; name: string; executables: string[] }>;
}
export interface CustomGame {
   name: string;
   executable: string;
}
export interface RecordingCapabilities {
   supported: boolean;
   hardwareEncoders: string[];
   recommended: "low" | "standard";
   message: string;
   captureBackend?: "wayland-portal";
   applicationBackend?: "xwayland";
   sourceKinds?: SourceKind[];
   portalPicker?: boolean;
}
export interface AdditionalAudioSource {
   id: string;
   name: string;
   kind: "source" | "application" | "input" | "output";
   deviceId: string;
   sourceId: string;
   executable: string;
   enabled: boolean;
   volume: number;
   muted: boolean;
   includeInMaster: boolean;
}
export interface AudioLevels {
   capture: number;
   microphone: number;
   additional?: Record<string, number>;
}
export interface Preferences {
   shortcuts: ShortcutBindings;
   collection: string;
   clipSeconds: number;
   shortcut: string;
   recordingPresetVersion: 1;
   recordingSizeVersion: 2;
   resolutionLimit: number;
   quality: "low" | "standard" | "high" | "custom";
   customWidth: number;
   customHeight: number;
   customFPS: number;
   customCQ: number;
   allowSoftwareEncoder: boolean;
   sourceKind: SourceKind;
   sourceId: string;
   microphone: boolean;
   microphoneDevice: string;
   captureAudio: boolean;
   captureVolume: number;
   captureMuted: boolean;
   microphoneVolume: number;
   microphoneMuted: boolean;
   desktopFallback: boolean;
   customGames: CustomGame[];
   audioSourcesVersion: 2;
   audioSources: AdditionalAudioSource[];
   shareSizeMB: number;
   autoShare: boolean;
   updateCheck: boolean;
   startWithOS: boolean;
   autoRecord: boolean;
   notifications: "everywhere" | "outside-fullscreen" | "off";
   sound: boolean;
   avoidOverlap: boolean;
   folderLayout: "flat" | "application";
   filenamePreset: "source-date" | "date-source" | "custom";
   filenameTemplate: string;
   setupComplete: boolean;
}
export interface AudioTrack {
   index: number;
   title: string;
   codec: string;
}
export interface Shareable {
   id: string;
   path: string;
   relativePath: string;
   size: number;
   targetMB: number;
   createdAt: number;
}
export interface Clip {
   applicationId?: string;
   id: string;
   originalMissing?: boolean;
   availability?: "unverified";
   path: string;
   relativePath: string;
   name: string;
   source: string;
   size: number;
   duration: number;
   width: number;
   height: number;
   createdAt: number;
   thumbnail: string;
   playbackUrl: string;
   tracks: AudioTrack[];
   categories: string[];
   shareables: Shareable[];
}
export interface Category {
   icon?: string | undefined;
   id: string;
   name: string;
   color: string;
}
export interface Job {
   id: string;
   clipId: string;
   kind: "shareable" | "save";
   state: "queued" | "running" | "complete" | "failed" | "cancelled";
   progress: number;
   message: string;
}
export interface RecorderState {
   state: "stopped" | "starting" | "recording" | "waiting" | "error";
   startedAt: number | null;
   availableSeconds: number;
   message: string;
   backend: string;
   supported: boolean;
   pendingSaves: number;
   sourceId?: string;
   sourceName?: string;
   sourceKind?: "screen" | "app" | "waiting";
}
export interface AvailableUpdate {
   version: string;
   name: string;
   url: string;
   mode: "automatic" | "download" | "releases";
}
export interface UpdateStatus {
   phase: "downloading" | "ready" | "downloaded" | "error";
   version: string;
   percent: number | null;
   message?: string;
   path?: string;
}
export interface UpdateState {
   lastChecked?: number;
   state: "idle" | "checking" | "available" | "downloading" | "ready" | "downloaded" | "error";
   version: string;
   progress: number;
   message: string;
   mode?: AvailableUpdate["mode"];
   url?: string;
   path?: string;
   indeterminate?: boolean;
}
export interface AppState {
   storageWarning?: string;
   windowVisible: boolean;
   preferences: Preferences;
   clips: Clip[];
   collectionStatus: {
      root: string;
      phase: "loading" | "refreshing" | "ready" | "error";
      error?: string;
      discovery?: { videos: number; byFolder: Record<string, number>; complete: boolean };
   };
   folders: string[];
   applicationIcons: Record<string, string>;
   categories: Category[];
   jobs: Job[];
   recorder: RecorderState;
   update: UpdateState;
   version: string;
   platform: string;
}
export type AppEvent =
   | { type: "state"; state: AppState }
   | { type: "notice"; message: string; error: boolean }
   | { type: "clip-action" }
   | { type: "audio-levels"; levels: AudioLevels }
   | { type: "audio-monitor"; monitorError: string; listeningError?: string }
   | { type: "visibility"; visible: boolean };
export interface DesktopAPI {
   state(): Promise<AppState>;
   sources(): Promise<CaptureSource[]>;
   games(): Promise<GameCandidate[]>;
   gameCatalog(): Promise<GameCatalogSnapshot>;
   recordingCapabilities(): Promise<RecordingCapabilities>;
   previewSource(sourceId: string | null, owner?: string): Promise<void>;
   monitorAudio(enabled: boolean): Promise<string[]>;
   listenAudio(source: string | null): Promise<void>;
   audioDevices(kind?: "input" | "output"): Promise<{ id: string; name: string }[]>;
   savePreferences(value: Preferences): Promise<AppState>;
   captureShortcut(enabled: boolean): Promise<void>;
   chooseFolder(): Promise<string | null>;
   startRecording(): Promise<void>;
   stopRecording(): Promise<void>;
   saveClip(): Promise<void>;
   createShareable(clipId: string, targetMB?: number): Promise<void>;
   cancelJob(id: string): Promise<void>;
   renameClip(id: string, name: string): Promise<void>;
   deleteClip(id: string, shareableId?: string): Promise<void>;
   category(
      action: "create" | "update" | "delete" | "assign",
      value: { id?: string; name?: string; color?: string; icon?: string; clipId?: string; categoryIds?: string[] }
   ): Promise<void>;
   reveal(path: string): Promise<void>;
   openInAttaCut(id: string): Promise<void>;
   dragFile(path: string): void;
   playback(path: string, track?: number): Promise<string>;
   refresh(): Promise<void>;
   checkUpdate(): Promise<void>;
   downloadUpdate(): Promise<void>;
   revealUpdate(): Promise<void>;
   openUpdateRelease(): Promise<void>;
   installUpdate(): Promise<void>;
   window(action: "minimize" | "maximize" | "close"): void;
   exit(): Promise<void>;
   onEvent(listener: (event: AppEvent) => void): () => void;
}
