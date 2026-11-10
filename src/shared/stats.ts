import { z } from "zod";

/**
 * Local usage history, kept so a stats page can answer questions the collection alone can't:
 * what got rewatched, how long saves take, how much capture time turns into clips.
 * Events only ever append. Clips are named by ID, never by path, so moving files changes nothing.
 */
export const statsVersion = 1;
/** Coarse replay map: how many times playback passed through each slice of a clip. */
export const watchedBuckets = 32;

const id = z.string().min(1).max(200);
const seconds = z
   .number()
   .min(0)
   .max(7 * 86_400);
const time = z.number().int().min(0);
const label = z.string().max(256);

/** How a save was asked for. */
export const saveTriggers = ["shortcut", "tray", "app", "command"] as const;
export type SaveTrigger = (typeof saveTriggers)[number];
/** Library and app actions worth counting. Clip-specific ones name the clip. */
export const statsActions = [
   "rename",
   "tag",
   "untag",
   "move",
   "reveal",
   "attacut",
   "trim",
   "folder-create",
   "folder-rename",
   "folder-move",
   "folder-delete",
   "tag-create",
   "tag-delete",
] as const;
export type StatsAction = (typeof statsActions)[number];

/** What the renderer may report. Main stamps the version and time. */
export const viewEventSchema = z
   .object({
      type: z.literal("view"),
      clipId: id,
      // Playback time in this session, so a rewatch of the same second counts again.
      seconds,
      duration: seconds,
      watched: z.array(z.number().int().min(0).max(255)).length(watchedBuckets),
      completed: z.boolean(),
   })
   .strict();

export const statsEventSchema = z.discriminatedUnion("type", [
   viewEventSchema,
   z
      .object({
         type: z.literal("save"),
         clipId: id,
         // From the shortcut to a usable file.
         latencyMs: z.number().int().min(0).max(3_600_000).optional(),
         seconds,
         outcome: z.enum(["saved", "extended"]),
         // The clip an extension grows; it absorbs this save.
         into: id.optional(),
         application: label.optional(),
         source: label.optional(),
         trigger: z.enum(saveTriggers).optional(),
         // The clip length setting at the time, to compare with what clips end up as.
         bufferSeconds: seconds.optional(),
      })
      .strict(),
   z
      .object({
         type: z.literal("capture"),
         startedAt: time,
         seconds,
         sourceKind: z.enum(["screen", "app"]).optional(),
         application: label.optional(),
         source: label.optional(),
         // Why capture ended: stopped by the user, an error, AcroClip exiting, or a collection switch.
         ended: z.enum(["stopped", "error", "exit", "collection"]).optional(),
      })
      .strict(),
   z
      .object({
         type: z.literal("shareable"),
         clipId: id,
         targetMB: z.number().positive(),
         bytes: z.number().int().min(0),
         sourceBytes: z.number().int().min(0),
         encodeSeconds: seconds,
         automatic: z.boolean(),
      })
      .strict(),
   z
      .object({
         type: z.literal("copy"),
         clipId: id,
         file: z.enum(["clip", "shareable"]),
         method: z.enum(["clipboard", "drag"]),
      })
      .strict(),
   z
      .object({
         type: z.literal("delete"),
         clipId: id,
         scope: z.enum(["clip", "shareable", "shareables"]),
         clipCreatedAt: time,
         duration: seconds,
         watched: z.boolean(),
         application: label.optional(),
      })
      .strict(),
   z
      .object({
         type: z.literal("launch"),
         version: z.string().max(100),
         // Set on the first launch after the version changed.
         previousVersion: z.string().max(100).optional(),
         // The previous run never closed cleanly: a crash, a kill or a power loss.
         unclean: z.boolean(),
         // Started by a clip command, such as a desktop shortcut running --clip.
         command: z.boolean(),
      })
      .strict(),
   z
      .object({
         // One stretch of the window being on screen, recorded when it hides.
         type: z.literal("window"),
         seconds,
      })
      .strict(),
   z
      .object({
         type: z.literal("action"),
         action: z.enum(statsActions),
         clipId: id.optional(),
      })
      .strict(),
   z
      .object({
         // Which settings changed, never their values.
         type: z.literal("settings"),
         keys: z.array(z.string().max(64)).min(1).max(80),
      })
      .strict(),
]);

export type ViewEvent = z.infer<typeof viewEventSchema>;
export type StatsEventInput = z.infer<typeof statsEventSchema>;
export type StatsEvent = StatsEventInput & { v: typeof statsVersion; at: number };

/** One file per month keeps appends small and lets old months be read or archived whole. */
export function statsFileName(at: number): string {
   const date = new Date(at);
   return `events-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}.jsonl`;
}

/** Reads a log, skipping lines a crash cut short or a later version wrote. */
export function parseStatsLog(text: string): StatsEvent[] {
   const events: StatsEvent[] = [];
   for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
         const value: unknown = JSON.parse(line);
         if (!value || typeof value !== "object" || !("v" in value) || value.v !== statsVersion || !("at" in value) || typeof value.at !== "number") continue;
         const { at, ...rest } = value as Record<string, unknown> & { at: number };
         delete rest["v"];
         const parsed = statsEventSchema.safeParse(rest);
         if (parsed.success) events.push({ ...parsed.data, v: statsVersion, at });
      } catch {
         /* A torn final line from an interrupted write. */
      }
   }
   return events;
}
