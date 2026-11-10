import { z } from "zod";
import { defaultPreferences } from "./defaults";
import type { Preferences } from "./types";

/**
 * What a factory reset can remove. The renderer's checklist and the native confirmation both
 * read these, so the two always describe the same thing.
 */
export const resetParts = ["settings", "cache", "logs", "stats", "layout"] as const;
export type ResetPart = (typeof resetParts)[number];

export interface ResetPartCopy {
   label: string;
   /** What goes, and what the user gives up with it. */
   detail: string;
}

export const resetPartCopy: Record<ResetPart, ResetPartCopy> = {
   settings: {
      label: "Settings and recording setup",
      detail: "Every setting, shortcut, audio source and custom game. Setup opens again, starting from the default clip folder.",
   },
   cache: {
      label: "Cache",
      detail: "Thumbnails, hover previews and playback copies. They rebuild in the background.",
   },
   logs: {
      label: "Logs",
      detail: "App and recorder logs, and the record of past runs. Bug reports made afterwards start from scratch.",
   },
   stats: {
      label: "Usage stats",
      detail: "This collection's history of capture time, saves, views and shares. Stats start over.",
   },
   layout: {
      label: "Layout",
      detail: "Panel sizes, the library view and its section order.",
   },
};

/** Ticked when the factory reset checklist opens. */
export const defaultResetParts: readonly ResetPart[] = resetParts;

export const resetPartsSchema = z
   .array(z.enum(resetParts))
   .min(1)
   .max(resetParts.length)
   .transform((parts) => resetParts.filter((part) => parts.includes(part)));

/**
 * What setup chooses: the capture source, quality, clip length and audio. Resetting these opens
 * setup again. Every other setting, apart from the collection folder, is a plain setting, so a
 * new preference lands there unless it is added here.
 */
export const recordingSetupKeys = [
   "sourceKind",
   "sourceId",
   "desktopFallback",
   "clipSeconds",
   "recordingPresetVersion",
   "recordingSizeVersion",
   "resolutionLimit",
   "quality",
   "customWidth",
   "customHeight",
   "customFPS",
   "customCQ",
   "allowSoftwareEncoder",
   "replayMemoryMB",
   "microphone",
   "microphoneDevice",
   "captureAudio",
   "captureVolume",
   "captureMuted",
   "microphoneVolume",
   "microphoneMuted",
   "audioSourcesVersion",
   "audioSources",
] as const satisfies ReadonlyArray<keyof Preferences>;

/** Never reset in place: the clips live there, and setup offers to change it. */
const keptKeys: ReadonlyArray<keyof Preferences> = ["collection", "setupComplete"];

export interface PreferenceResetParts {
   settings: boolean;
   setup: boolean;
}

export const preferenceResetSchema = z
   .object({ settings: z.boolean(), setup: z.boolean() })
   .strict()
   .refine((parts) => parts.settings || parts.setup, "Choose what to reset.");

export const preferenceResetCopy: Record<keyof PreferenceResetParts, ResetPartCopy> = {
   settings: {
      label: "Settings",
      detail: "Shortcuts, notifications, shareables, games, file names and startup go back to their defaults.",
   },
   setup: {
      label: "Recording setup",
      detail: "Capture source, quality, clip length and audio go back to their defaults, and setup opens so you can choose them again.",
   },
};

/** The current preferences with the chosen groups back at their defaults. */
export function resetPreferenceGroups(current: Preferences, parts: PreferenceResetParts): Preferences {
   const defaults = structuredClone(defaultPreferences);
   const next = { ...current };
   const setup: ReadonlyArray<keyof Preferences> = recordingSetupKeys;
   for (const key of Object.keys(defaults) as Array<keyof Preferences>) {
      if (keptKeys.includes(key)) continue;
      if (setup.includes(key) ? parts.setup : parts.settings) Object.assign(next, { [key]: defaults[key] });
   }
   if (parts.setup) next.setupComplete = false;
   return next;
}

export interface HistoryParts {
   logs: boolean;
   stats: boolean;
}

export const historyPartsSchema = z
   .object({ logs: z.boolean(), stats: z.boolean() })
   .strict()
   .refine((parts) => parts.logs || parts.stats, "Choose what to clear.");

/** The native confirmation's detail line for a factory reset. */
export function factoryResetDetail(parts: readonly ResetPart[]): string {
   const names = parts.map((part) => resetPartCopy[part].label.toLowerCase());
   const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}` : names[0]!;
   const setup = parts.includes("settings") ? " and opens setup" : "";
   return `This removes ${list}. AcroClip restarts${setup}. Your clips, tags and shareables stay where they are. This can't be undone.`;
}
