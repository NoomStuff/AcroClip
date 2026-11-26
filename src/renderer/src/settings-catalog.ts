import type { LucideIcon } from "lucide-react";
import { Bell, Film, Gamepad2, Keyboard, Settings2, Star, Video } from "lucide-react";
import type { ShortcutAction } from "../../shared/shortcuts";
import { shortcutRegistry } from "../../shared/shortcuts";

export const settingSections = [
   { id: "essentials", label: "Essentials", icon: Star },
   { id: "clips", label: "Clips", icon: Film },
   { id: "recording", label: "Recording", icon: Video },
   { id: "games", label: "Games", icon: Gamepad2 },
   { id: "notifications", label: "Notifications", icon: Bell },
   { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
   { id: "app", label: "App", icon: Settings2 },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];
export type SettingSection = (typeof settingSections)[number]["id"];

interface SettingCopy {
   label: string;
   /** Settings shown inside this one, like the quality details. They rank like the label. */
   names?: readonly string[];
   /** The choices it offers. */
   options?: readonly string[];
   /** The description under the label. Some settings change theirs with their value, so this is the text search knows. */
   detail?: string;
   /** What people type that the copy doesn't say. */
   keywords?: string;
}
/** On Linux, closing the window quits AcroClip instead of leaving it in the tray. */
export function startWithOSDetail(platform: string): string {
   return platform === "linux" ? "Opens when you sign in. Closing the window quits AcroClip and stops capturing." : settingCopy.startWithOS.detail;
}
/** The copy Settings shows and search reads, kept in one place so the two can't drift. */
export const settingCopy = {
   clip: {
      label: "Save a clip",
      names: ["Clip length", "Clip shortcut"],
      detail: "Press the shortcut in any app to save the last part of what you captured.",
      keywords: "duration seconds minutes replay buffer hotkey keybind",
   },
   overlap: {
      label: "Overlapping clips",
      options: ["Save normally", "Save what's new", "Extend previous clip"],
      detail: "What happens when you save again soon after a clip.",
      keywords: "overlap merge trim duplicate back to back",
   },
   quality: {
      label: "Quality",
      names: ["Preset", "Resolution limit", "Frame rate", "Compression", "Replay memory", "Allow software encoding"],
      options: ["Low", "Standard", "High", "Custom", "720p", "1080p", "1440p", "4K", "Source", "30", "60", "120"],
      detail: "Screens scale to the resolution limit. Lower compression keeps more detail and uses more space.",
      keywords: "fps bitrate ram encoder cpu gpu",
   },
   qualityPreset: { label: "Quality", names: ["Preset"], options: ["Low", "Standard", "High", "Custom"] },
   sources: {
      label: "Capture page",
      detail: "Choose what to capture and set up your audio.",
      keywords: "source screen monitor window application game audio microphone mic desktop volume mixer filter noise",
   },
   autoRecord: {
      label: "Start capturing when AcroClip opens",
      detail: "Your clip shortcut works as soon as it opens. App and game sources wait until they're running.",
      keywords: "auto automatic record launch",
   },
   games: {
      label: "Games",
      names: ["Added games"],
      detail: "Auto captures recognized games. Add one if AcroClip doesn't recognize it.",
      keywords: "game detect recognize list application executable exe",
   },
   folder: {
      label: "Collection folder",
      options: ["Change folder"],
      keywords: "location path directory where storage disk drive save move",
   },
   grouping: {
      label: "Group clips by application",
      detail: "Save new clips in application folders. Existing files stay where they are.",
      keywords: "subfolder organize per game",
   },
   filename: {
      label: "File name",
      options: ["App + date", "Date + app", "Replay + date", "Compact", "Custom"],
      keywords: "filename pattern template naming",
   },
   shareSize: {
      label: "Shareable size",
      options: ["10 MB", "20 MB", "50 MB", "100 MB", "Custom"],
      detail: "Shareables compress to fit under this size. You can pick another size for each clip.",
      keywords: "share limit megabytes discord upload",
   },
   autoShare: {
      label: "Automatically create shareables",
      detail: "Compress a copy after each save. Uses extra resources while capturing.",
      keywords: "share discord upload",
   },
   discord: {
      label: "Discord status",
      options: ["Off", "Minimal", "Full"],
      detail: "Adds AcroClip rich presence to the game you're capturing.",
      keywords: "activity",
   },
   notifications: {
      label: "Notifications",
      names: ["Capture started", "Capture stopped", "Save clip", "Now capturing", "Stopped capturing game", "Capture paused", "Capture resumed", "Error"],
      options: ["Banner", "Sound"],
      keywords: "popup toast alert chime beep",
   },
   startWithOS: {
      label: "Start with your computer",
      detail: "Opens when you sign in, so your shortcuts work without opening AcroClip first.",
      keywords: "startup boot login launch windows autostart",
   },
   startInTray: {
      label: "Start in the tray",
      detail: "Starts with the window closed. Open it from the tray icon.",
      keywords: "hidden minimized background quiet startup login",
   },
   updates: {
      label: "Updates",
      names: ["Check for updates automatically"],
      options: ["Check for updates"],
      keywords: "upgrade version download release",
   },
   reportBug: { label: "Report a bug", detail: "Saves your logs to Downloads and opens a bug report on GitHub.", keywords: "issue problem feedback crash" },
   exportLogs: { label: "Export logs", detail: "Save logs and system details as a zip.", keywords: "diagnostics support" },
   resetSettings: { label: "Reset settings & setup", detail: "Reset settings, capture setup or both.", keywords: "defaults onboarding restore" },
   clearCache: { label: "Clear cache", detail: "Thumbnails and playback copies rebuild in the background.", keywords: "previews space" },
   clearHistory: { label: "Clear usage history", detail: "Remove logs, usage stats or both.", keywords: "statistics privacy" },
   factoryReset: { label: "Factory reset", detail: "Choose what to remove, then AcroClip restarts.", keywords: "wipe everything" },
   shortcutSheet: { label: "Shortcut sheet", detail: "Every shortcut on one screen.", keywords: "hotkey keyboard cheat" },
} as const satisfies Record<string, SettingCopy>;
type FixedSetting = keyof typeof settingCopy;
export type SettingId = FixedSetting | `shortcut:${ShortcutAction}`;

export interface SettingGroup {
   id: string;
   section: SettingSection;
   title?: string;
   detail?: string;
   items: readonly SettingId[];
   /** Essentials repeats settings that live elsewhere. Search only lists a setting where it lives. */
   home: boolean;
   /** Points from a short list to the full one. */
   more?: SettingSection;
   danger?: boolean;
}

type Shortcut = (typeof shortcutRegistry)[number];
const shortcutGroupTests: { id: string; title: string; detail?: string; test: (item: Shortcut) => boolean }[] = [
   { id: "shortcuts-global", title: "Capture", detail: "Work in any app, including fullscreen games.", test: (item) => item.scope === "global" },
   {
      id: "shortcuts-navigation",
      title: "Navigation",
      detail: "While AcroClip is open.",
      test: (item) => item.scope === "local" && item.page === "all",
   },
   { id: "shortcuts-library", title: "Library", test: (item) => item.page === "library" },
   { id: "shortcuts-player", title: "Player", detail: "While a clip is open.", test: (item) => item.page === "viewer" },
   { id: "shortcuts-settings", title: "Settings", test: (item) => item.page === "settings" },
];
const shortcutGroups = shortcutGroupTests.map(({ test, ...group }): SettingGroup => ({
   ...group,
   section: "shortcuts",
   home: true,
   items: shortcutRegistry.filter(test).map((item) => `shortcut:${item.id}` as const),
}));

export const settingGroups: readonly SettingGroup[] = [
   { id: "essentials-clip", section: "essentials", title: "Clipping", items: ["shortcut:toggleRecording", "clip", "overlap"], home: false, more: "clips" },
   { id: "essentials-quality", section: "essentials", title: "Quality", items: ["qualityPreset"], home: false, more: "recording" },
   { id: "essentials-saving", section: "essentials", title: "Saving", items: ["folder", "shareSize"], home: false, more: "clips" },
   { id: "essentials-startup", section: "essentials", title: "Startup", items: ["startWithOS", "startInTray", "autoRecord"], home: false, more: "app" },
   { id: "clips-clip", section: "clips", title: "Clip", items: ["clip", "overlap"], home: true },
   { id: "clips-saving", section: "clips", title: "Saving", items: ["folder", "grouping", "filename"], home: true },
   { id: "clips-shareables", section: "clips", title: "Shareables", items: ["shareSize", "autoShare"], home: true },
   { id: "recording-sources", section: "recording", items: ["sources"], home: true },
   { id: "recording-quality", section: "recording", title: "Quality", items: ["quality"], home: true },
   { id: "games", section: "games", items: ["games"], home: true },
   { id: "notifications", section: "notifications", items: ["notifications"], home: true },
   { id: "shortcuts-sheet", section: "shortcuts", items: ["shortcutSheet"], home: true },
   ...shortcutGroups,
   { id: "app-startup", section: "app", title: "Startup", items: ["startWithOS", "startInTray", "autoRecord"], home: true },
   { id: "app-discord", section: "app", title: "Discord", items: ["discord"], home: true },
   { id: "app-updates", section: "app", title: "Updates", items: ["updates"], home: true },
   { id: "app-troubleshooting", section: "app", title: "Troubleshooting", items: ["reportBug", "exportLogs"], home: true },
   {
      id: "app-maintenance",
      section: "app",
      title: "Maintenance",
      detail: "None of these touch your clips.",
      items: ["resetSettings", "clearCache", "clearHistory", "factoryReset"],
      home: true,
      danger: true,
   },
];

export function sectionLabel(id: SettingSection): string {
   return settingSections.find((section) => section.id === id)!.label;
}

/** How clearly a setting matches: by its name, by one of its choices, or only by its description. */
export type MatchStrength = 1 | 2 | 3;

function settingTiers(id: SettingId): readonly [string, string, string] {
   if (id.startsWith("shortcut:")) {
      const item = shortcutRegistry.find((entry) => `shortcut:${entry.id}` === id)!;
      return [item.label, "", "shortcut hotkey keybind key binding"];
   }
   const copy: SettingCopy = settingCopy[id as FixedSetting];
   return [[copy.label, ...(copy.names ?? [])].join(" "), (copy.options ?? []).join(" "), `${copy.detail ?? ""} ${copy.keywords ?? ""}`];
}

export function searchWords(text: string): string[] {
   return text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
}

/** The visible text search reads for a setting: its names, choices and description. Only these get highlighted. */
export function searchableText(id: SettingId): string[] {
   if (id.startsWith("shortcut:")) return [shortcutRegistry.find((entry) => `shortcut:${entry.id}` === id)!.label];
   const copy: SettingCopy = settingCopy[id as FixedSetting];
   return [copy.label, ...(copy.names ?? []), ...(copy.options ?? []), ...(copy.detail ? [copy.detail] : [])];
}

/**
 * Every word typed has to start a word in the setting's own copy, so results narrow as you type. Group and tab names
 * don't count, or typing a tab's name would match everything on it. A setting is only as strong as its weakest word:
 * "save normally" finds Overlapping clips by its choice, not by its name.
 */
function matchStrength(id: SettingId, wanted: readonly string[]): MatchStrength | 0 {
   const [names, options, context] = settingTiers(id).map(searchWords) as [string[], string[], string[]];
   let strength: MatchStrength = 3;
   for (const word of wanted) {
      const starts = (list: readonly string[]) => list.some((candidate) => candidate.startsWith(word));
      const found: MatchStrength | 0 = starts(names) ? 3 : starts(options) ? 2 : starts(context) ? 1 : 0;
      if (!found) return 0;
      strength = Math.min(strength, found) as MatchStrength;
   }
   return strength;
}

/** Groups with a stronger match come first. Equal ones keep the order Settings uses, so close calls never shuffle. */
export function searchSettings(query: string): { group: SettingGroup; items: SettingId[]; strength: MatchStrength }[] {
   const wanted = searchWords(query);
   if (!wanted.length) return [];
   return settingGroups
      .filter((group) => group.home)
      .map((group) => {
         const scored = group.items.map((id) => [id, matchStrength(id, wanted)] as const).filter(([, strength]) => strength > 0);
         return {
            group,
            items: scored.map(([id]) => id),
            strength: Math.max(0, ...scored.map(([, strength]) => strength)) as MatchStrength,
         };
      })
      .filter((result) => result.items.length > 0)
      .sort((a, b) => b.strength - a.strength);
}
