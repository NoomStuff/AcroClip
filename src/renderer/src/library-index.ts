import { normalizeApplicationLabel } from "../../shared/application-label";
import type { Clip } from "../../shared/types";
export type LibrarySectionId = "tags" | "applications" | "folders";
export function orderLibrarySections(populated: Record<LibrarySectionId, boolean>, order: readonly string[]) {
   const sections = [
      { id: "tags", label: "Tags", empty: !populated.tags },
      { id: "applications", label: "Applications", empty: !populated.applications },
      { id: "folders", label: "Folders", empty: !populated.folders },
   ] satisfies Array<{ id: LibrarySectionId; label: string; empty: boolean }>;
   const position = (id: string) => (order.indexOf(id) < 0 ? sections.length : order.indexOf(id));
   sections.sort((a, b) => position(a.id) - position(b.id));
   return sections;
}
export function applicationKeys(clips: readonly Clip[]): Map<string, string> {
   const labels = new Map<string, string>();
   const known = new Map<string, string>();
   for (const clip of clips) {
      let label = labels.get(clip.source);
      if (label === undefined) {
         label = normalizeApplicationLabel(clip.source).toLowerCase();
         labels.set(clip.source, label);
      }
      if (clip.applicationId) known.set(label, clip.applicationId);
   }
   const keys = new Map<string, string>();
   for (const clip of clips) {
      const label = labels.get(clip.source)!;
      if (label !== "desktop") keys.set(clip.id, clip.applicationId ?? known.get(label) ?? `label:${label}`);
   }
   return keys;
}

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

export interface VisibleFolderRow {
   id: string;
   level: number;
   hasChildren: boolean;
   open: boolean;
   position: number;
   siblings: number;
}
export function visibleFolderRows(children: ReadonlyMap<string, readonly string[]>, expanded: ReadonlySet<string>): VisibleFolderRow[] {
   const rows: VisibleFolderRow[] = [];
   const visit = (parent: string, level: number) => {
      const siblings = children.get(parent) ?? [];
      siblings.forEach((id, index) => {
         const hasChildren = children.has(id);
         const open = expanded.has(id);
         rows.push({ id, level, hasChildren, open, position: index + 1, siblings: siblings.length });
         if (hasChildren && open) visit(id, level + 1);
      });
   };
   visit("", 1);
   return rows;
}

export type LibrarySortField = "date" | "name" | "size" | "length";
/** Each field sorts in its natural direction first: newest, A to Z, largest, longest. */
export interface LibrarySort {
   field: LibrarySortField;
   reversed: boolean;
}
export const defaultLibrarySort: LibrarySort = { field: "date", reversed: false };
export function compareClips(sort: LibrarySort): (a: Clip, b: Clip) => number {
   return (a, b) => {
      const natural =
         sort.field === "name"
            ? a.name.localeCompare(b.name)
            : sort.field === "size"
              ? b.size - a.size
              : sort.field === "length"
                ? b.duration - a.duration
                : b.createdAt - a.createdAt;
      return (sort.reversed ? -natural : natural) || b.createdAt - a.createdAt || a.relativePath.localeCompare(b.relativePath);
   };
}
export interface FolderSummary {
   newest: number;
   oldest: number;
   size: number;
   duration: number;
   matchingSize: number;
   count: number;
   matchingCount: number;
}
/** The bytes a clip takes on disk: its newest shareable once the original is gone. */
export const storedSize = (clip: Clip): number => (clip.originalMissing ? (clip.shareables.at(-1)?.size ?? clip.size) : clip.size);
const matchesSearch = (clip: Clip, search: string) => !search || `${clip.name} ${clip.source}`.toLowerCase().includes(search);
export function parentFolder(path: string): string {
   const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
   return end < 0 ? "" : path.slice(0, end).replaceAll("\\", "/");
}

export function summarizeFolders(clips: readonly Clip[], search: string): Map<string, FolderSummary> {
   const result = new Map<string, FolderSummary>();
   for (const clip of clips) {
      const matches = matchesSearch(clip, search);
      let folder = parentFolder(clip.relativePath);
      for (;;) {
         let summary = result.get(folder);
         if (!summary) {
            summary = { newest: clip.createdAt, oldest: clip.createdAt, size: 0, duration: 0, count: 0, matchingCount: 0, matchingSize: 0 };
            result.set(folder, summary);
         }
         summary.newest = Math.max(summary.newest, clip.createdAt);
         summary.oldest = Math.min(summary.oldest, clip.createdAt);
         summary.size += clip.size;
         summary.duration += clip.duration;
         summary.count++;
         if (matches) {
            summary.matchingCount++;
            summary.matchingSize += storedSize(clip);
         }
         if (!folder) break;
         folder = parentFolder(folder);
      }
   }
   return result;
}

export function selectChildFolders(paths: readonly string[], search: string, summaries: ReadonlyMap<string, FolderSummary>, sort: LibrarySort): string[] {
   return paths
      .filter(
         (path) =>
            !search ||
            path
               .slice(path.lastIndexOf("/") + 1)
               .toLowerCase()
               .includes(search) ||
            summaries.get(path)?.matchingCount
      )
      .sort((a, b) => {
         const first = summaries.get(a),
            second = summaries.get(b);
         // Folders follow the clips inside them: their newest or oldest clip, or their totals.
         const natural =
            sort.field === "name"
               ? a.localeCompare(b)
               : sort.field === "size"
                 ? (second?.size ?? 0) - (first?.size ?? 0)
                 : sort.field === "length"
                   ? (second?.duration ?? 0) - (first?.duration ?? 0)
                   : sort.reversed
                     ? (second?.oldest ?? 0) - (first?.oldest ?? 0)
                     : (second?.newest ?? 0) - (first?.newest ?? 0);
         return (sort.reversed ? -natural : natural) || a.localeCompare(b);
      });
}

export function selectLibraryClips(
   clips: readonly Clip[],
   {
      search,
      filter,
      folderPath,
      sort,
      applications,
   }: {
      search: string;
      filter: string;
      folderPath: string | null;
      sort: LibrarySort;
      applications: ReadonlyMap<string, string>;
   }
): Clip[] {
   return clips
      .filter(
         (clip) =>
            matchesSearch(clip, search) &&
            (filter === "all" ||
               (filter.startsWith("category:") && clip.categories.includes(filter.slice(9))) ||
               (filter.startsWith("source:") && applications.get(clip.id) === filter.slice(7)) ||
               (folderPath !== null && parentFolder(clip.relativePath) === folderPath))
      )
      .sort(compareClips(sort));
}
