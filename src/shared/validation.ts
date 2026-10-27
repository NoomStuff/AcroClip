import { z } from "zod";
import { shortcutRegistry } from "./shortcuts";
import { validFilenameTemplate } from "./filename";
import { normalizeMicrophone } from "./audio-model";
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
      notifications: z.enum(["everywhere", "outside-fullscreen", "off"]),
      sound: z.boolean(),
      avoidOverlap: z.boolean(),
      folderLayout: z.enum(["flat", "application"]),
      filenamePreset: z.enum(["source-date", "date-source", "custom"]),
      filenameTemplate: z.string().refine(validFilenameTemplate, "Use supported filename tokens without folder separators"),
      setupComplete: z.boolean(),
   })
   .strict();
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
