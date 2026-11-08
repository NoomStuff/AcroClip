import type { Clip } from "../../shared/types";
import { formatSize } from "./format";

/** A file people can take out of AcroClip: the clip itself or one of its shareables. */
export interface ClipFile {
   path: string;
   // The player's names: "Clip" and "Shareable 1".
   name: string;
   size: number;
   available: boolean;
}

export function clipFiles(clip: Clip): { original: ClipFile; shareables: ClipFile[] } {
   return {
      original: { path: clip.path, name: "Clip", size: clip.size, available: !clip.originalMissing },
      shareables: clip.shareables.map((shareable, index) => ({ path: shareable.path, name: `Shareable ${index + 1}`, size: shareable.size, available: true })),
   };
}

/** A shareable exists to be shared, so the newest one wins over the original. */
export function defaultClipFile(clip: Clip): ClipFile | undefined {
   const { original, shareables } = clipFiles(clip);
   return shareables.at(-1) ?? (original.available ? original : undefined);
}

export const clipFileLabel = (file: ClipFile): string => `${file.name} · ${formatSize(file.size)}`;
export const copiedMessage = (file: ClipFile): string => `Copied ${file.name.toLowerCase()} · ${formatSize(file.size)}`;
