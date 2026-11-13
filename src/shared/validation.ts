import { z } from "zod";
import { shortcutRegistry } from "./shortcuts";
import { validFilenameTemplate } from "./filename";
import { normalizeMicrophone } from "./audio-model";
import { audioFilterDefinitions, audioFilterKinds, defaultAudioFilterSettings, maxAudioFilters } from "./audio-filters";
import type { AudioFilter } from "./audio-filters";
import { resetParts } from "./maintenance";
import type { RendererError } from "./diagnostics";
import { replayMemoryBounds } from "./replay-memory";
// Every schema lives here or in stats-log.ts, so the renderer, which validates nothing, ships without zod.
const audioFilterSchema = z
   .object({
      id: z.string().min(1).max(200),
      kind: z.enum(audioFilterKinds),
      enabled: z.boolean(),
      settings: z.record(z.string(), z.union([z.number(), z.string()])),
   })
   .strict()
   .superRefine((filter, context) => {
      const definition = audioFilterDefinitions[filter.kind];
      const known = new Set([...definition.parameters.map((item) => item.key), ...(definition.choices ?? []).map((item) => item.key)]);
      for (const key of Object.keys(filter.settings))
         if (!known.has(key)) context.addIssue({ code: "custom", message: `${definition.label} has no ${key} setting` });
      for (const parameter of definition.parameters) {
         const value = filter.settings[parameter.key];
         if (value === undefined) continue;
         if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < parameter.min ||
            value > parameter.max ||
            (parameter.integer && !Number.isInteger(value))
         )
            context.addIssue({ code: "custom", message: `${definition.label} ${parameter.label.toLowerCase()} is out of range` });
      }
      for (const choice of definition.choices ?? []) {
         const value = filter.settings[choice.key];
         if (value !== undefined && !choice.values.some((item) => item.value === value))
            context.addIssue({ code: "custom", message: `Choose a ${choice.label.toLowerCase()} for ${definition.label}` });
      }
   })
   // Missing settings take OBS's defaults, so stored chains survive new parameters.
   .transform((filter): AudioFilter => ({ ...filter, settings: { ...defaultAudioFilterSettings(filter.kind), ...filter.settings } }));
export const audioFilterChainSchema = z
   .array(audioFilterSchema)
   .max(maxAudioFilters, `Each audio source supports up to ${maxAudioFilters} filters`)
   .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Audio filter IDs must be unique");
export const preferencesSchema = z
   .object({
      collection: z.string().trim().min(1).max(4096),
      clipSeconds: z.number().int().min(5).max(1800),
      shortcut: z.string().min(1).max(100),
      shortcuts: z
         .preprocess(
            (value) => {
               if (typeof value !== "object" || value === null || Array.isArray(value) || !("refresh" in value)) return value;
               const shortcuts: Record<string, unknown> = { ...value };
               delete shortcuts["refresh"];
               return shortcuts;
            },
            z.partialRecord(z.enum(shortcutRegistry.map((item) => item.id)), z.string().max(100))
         )
         .default({}),
      recordingPresetVersion: z.literal(1).default(1),
      recordingSizeVersion: z.literal(2).default(2),
      resolutionLimit: z
         .number()
         .int()
         .min(0)
         .max(4320)
         .refine((value) => value === 0 || value >= 64)
         .default(1080),
      quality: z.enum(["low", "standard", "high", "custom"]),
      customWidth: z
         .number()
         .int()
         .min(64)
         .max(7680)
         .refine((value) => value % 2 === 0, "Use an even recording width"),
      customHeight: z
         .number()
         .int()
         .min(64)
         .max(4320)
         .refine((value) => value % 2 === 0, "Use an even recording height"),
      customFPS: z.number().int().min(1).max(120),
      customCQ: z.number().int().min(12).max(35),
      allowSoftwareEncoder: z.boolean(),
      replayMemoryMB: z
         .number()
         .int()
         .refine((value) => value === 0 || (value >= replayMemoryBounds.min && value <= replayMemoryBounds.max), "Choose a replay memory size")
         .default(0),
      sourceKind: z.enum(["screen", "app", "auto"]),
      sourceId: z.string().max(1000),
      microphone: z.boolean(),
      microphoneDevice: z.string().max(1000),
      captureAudio: z.boolean(),
      captureVolume: z.number().min(0).max(4),
      captureMuted: z.boolean(),
      microphoneVolume: z.number().min(0).max(4),
      microphoneMuted: z.boolean(),
      desktopFallback: z.boolean(),
      customGames: z
         .array(z.object({ name: z.string().trim().min(1).max(200), executable: z.string().min(1).max(4096) }).strict())
         .max(500)
         .default([]),
      audioSourcesVersion: z.literal(2).default(2),
      audioSources: z
         .array(
            z
               .object({
                  id: z
                     .string()
                     .min(1)
                     .max(200)
                     .refine((value) => !["capture", "microphone"].includes(value), "Choose a unique audio source ID"),
                  name: z.string().trim().min(1).max(100),
                  kind: z.enum(["source", "application", "input", "output"]),
                  deviceId: z.string().max(1000),
                  sourceId: z.string().max(1000),
                  executable: z.string().max(4096),
                  enabled: z.boolean(),
                  volume: z.number().min(0).max(4),
                  muted: z.boolean(),
                  includeInMaster: z.boolean(),
                  filters: audioFilterChainSchema.default([]),
               })
               .strict()
               .transform(normalizeMicrophone)
         )
         .max(5)
         .refine((items) => items.filter((item) => item.kind === "source").length <= 1, "Source audio is already added")
         .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Audio source IDs must be unique")
         .default([]),
      shareSizeMB: z.number().min(1).max(2000),
      autoShare: z.boolean(),
      updateCheck: z.boolean().default(true),
      startWithOS: z.boolean(),
      autoRecord: z.boolean(),
      notificationStartBanner: z.boolean().default(true),
      notificationStartSound: z.boolean().default(true),
      notificationStopBanner: z.boolean().default(true),
      notificationStopSound: z.boolean().default(true),
      notificationSaveBanner: z.boolean().default(true),
      notificationSaveSound: z.boolean().default(true),
      notificationGameBanner: z.boolean().default(true),
      notificationGameLostBanner: z.boolean().default(false),
      notificationPauseBanner: z.boolean().default(true),
      notificationResumeBanner: z.boolean().default(true),
      notificationErrorBanner: z.literal(true).default(true),
      notificationErrorSound: z.boolean().default(true),
      overlapClips: z.enum(["keep", "trim", "merge"]),
      folderLayout: z.enum(["flat", "application"]),
      filenamePreset: z.enum(["source-date", "date-source", "replay", "compact", "custom"]),
      filenameTemplate: z.string().refine(validFilenameTemplate, "Use supported filename tokens without folder separators"),
      setupComplete: z.boolean(),
   })
   .strict();
export const preferenceKeysSchema = z.array(preferencesSchema.keyof()).max(100);
export const idSchema = z.string().min(1).max(200);
export const categoryRequest = z
   .object({
      id: z.string().max(200).optional(),
      name: z.string().trim().min(1).max(80).optional(),
      color: z
         .string()
         .regex(/^#[0-9a-fA-F]{6}$/)
         .optional(),
      icon: z.string().max(80).optional(),
      clipId: z.string().max(200).optional(),
      categoryIds: z.array(z.string().max(200)).max(100).optional(),
   })
   .strict();
export const rendererErrorSchema = z
   .object({
      kind: z.enum(["error", "rejection", "react"]),
      message: z.string().max(4000),
      stack: z.string().max(16_000).optional(),
      source: z.string().max(16_000).optional(),
   })
   .strict() satisfies z.ZodType<RendererError>;
export const resetPartsSchema = z
   .array(z.enum(resetParts))
   .min(1)
   .max(resetParts.length)
   .transform((parts) => resetParts.filter((part) => parts.includes(part)));
export const preferenceResetSchema = z
   .object({ settings: z.boolean(), setup: z.boolean() })
   .strict()
   .refine((parts) => parts.settings || parts.setup, "Choose what to reset.");
export const historyPartsSchema = z
   .object({ logs: z.boolean(), stats: z.boolean() })
   .strict()
   .refine((parts) => parts.logs || parts.stats, "Choose what to clear.");
