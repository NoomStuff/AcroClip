import { z } from "zod";

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
