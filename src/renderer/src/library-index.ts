import type { Clip } from "../../shared/types";

export function summarizeClips(clips: readonly Clip[]): { size: number; categories: Map<string, number> } {
   let size = 0;
   const categories = new Map<string, number>();
   for (const clip of clips) {
      size += clip.size;
      for (const id of new Set(clip.categories)) categories.set(id, (categories.get(id) ?? 0) + 1);
   }
   return { size, categories };
}

export function groupFolders(paths: readonly string[]): Map<string, string[]> {
   const result = new Map<string, string[]>();
   for (const path of paths) {
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const siblings = result.get(parent);
      if (siblings) siblings.push(path);
      else result.set(parent, [path]);
   }
   return result;
}
