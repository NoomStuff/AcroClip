import { z } from "zod";

/**
 * What a saved MP4 says about itself, in its "acroclip" metadata tag. The collection's metadata is
 * the main record. This copy lets a clip moved to another collection, or one whose `.acroclip`
 * folder was lost, still know its game. It's written once when the clip is saved, never rewritten.
 */
export const clipTagSchema = z.object({
   version: z.literal(1),
   /** When the save was requested, in milliseconds since 1970. */
   savedAt: z.number().int().nonnegative().optional(),
   /** The capture source's name, written by the recorder from the footage itself. */
   source: z.string().max(256).optional(),
   application: z.object({ id: z.string().min(1).max(512), name: z.string().max(256).optional() }).optional(),
});
export type ClipTag = z.infer<typeof clipTagSchema>;

/** The tag read back from ffprobe's format tags. Anything malformed counts as no tag. */
export function parseClipTag(value: string | undefined): ClipTag | undefined {
   if (!value || value.length > 4096) return undefined;
   try {
      const parsed = clipTagSchema.safeParse(JSON.parse(value));
      return parsed.success ? parsed.data : undefined;
   } catch {
      return undefined;
   }
}
