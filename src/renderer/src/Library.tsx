import { normalizeApplicationLabel } from "../../shared/application-label";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import {
   AlertCircle,
   Folder,
   FolderInput,
   FolderOpen,
   FolderPlus,
   Grid2X2,
   List,
   MoreHorizontal,
   Pencil,
   Plus,
   Search,
   Trash2,
   X,
   ZoomIn,
   ZoomOut,
} from "lucide-react";
import type { AppState, Category, Clip } from "../../shared/types";
import type { Ask } from "./Dialog";
import { clipDragType, readCollectionDrag } from "./clip-drag";
import { useThumbnailSize } from "./useThumbnailSize";
import { gridZoomRange, gridZoomTarget } from "./thumbnail-scale";
import { Slider } from "./Slider";
import { SelectionIndicator } from "./SelectionIndicator";
import { MotionList } from "./MotionList";
import { ContextHeader, Button, Empty, IconButton, Menu, MenuItem, Select } from "./ui";
import { api, reportFeedback } from "./desktop";
import { MoveDialog } from "./MoveDialog";
import { initialLocation, reportLocation } from "./navigation-history";
import type { NavigationLocation } from "./navigation-history";

function readThumbnailSize(view: "grid" | "list"): number {
   const fallback = view === "grid" ? 250 : 96;
   try {
      const stored = localStorage.getItem(`acroclip.library.scale.${view}`);
      const value = stored === null ? fallback : Number(stored);
      return Number.isFinite(value) ? Math.max(view === "grid" ? 220 : 80, Math.min(view === "grid" ? 440 : 192, value)) : fallback;
   } catch {
      return fallback;
   }
}
import { age, folderName, formatSize } from "./format";
import type { Run } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { ClipCard } from "./ClipCard";
import { FolderCard } from "./FolderCard";
import { FolderTree } from "./FolderTree";
import { categoryColors, categoryStyle } from "./category-color";
import { CategoryEditor, CategoryMark } from "./CategoryEditor";
import { useGridMotion } from "./useGridMotion";
import { PaneDivider, usePaneSize } from "./layout";
import { useApplicationColors } from "./useApplicationColors";
import type { ContextMenuRequest } from "./ui";
import { useAttaCutAvailable } from "./useAttaCutAvailable";
import { applicationKeys, summarizeClips, orderLibrarySections, summarizeFolders, selectChildFolders, selectLibraryClips } from "./library-index";
import type { LibrarySectionId, LibraryOrder } from "./library-index";
import { LibrarySection } from "./LibrarySection";

export function Library({
   state,
   visible = true,
   run,
   ask,
   openClip,
   openSettings,
   openGames,
}: {
   state: Pick<AppState, "clips" | "folders" | "applicationIcons" | "categories" | "collectionStatus" | "jobs" | "preferences" | "platform">;
   visible?: boolean;
   run: Run;
   ask: Ask;
   openClip: (clip: Clip) => void;
   openSettings: () => void;
   openGames: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const searchInput = useRef<HTMLInputElement>(null);
   const scrollArea = useRef<HTMLDivElement>(null);
   const [placeholderCount, setPlaceholderCount] = useState(8);
   const [view, setView] = useState<"grid" | "list">(() => {
      try {
         return localStorage.getItem("acroclip.library.view") === "list" ? "list" : "grid";
      } catch {
         return "grid";
      }
   });
   const [gridMetrics, setGridMetrics] = useState({ width: 0, gap: 18 });
   const [thumbnailSizes, setThumbnailSizes] = useState(() => ({ grid: readThumbnailSize("grid"), list: readThumbnailSize("list") }));
   const gridScale = gridZoomRange(gridMetrics.width, gridMetrics.gap, thumbnailSizes.grid);
   const listSizing = useThumbnailSize(layout, thumbnailSizes.list, visible && view === "list");
   const resizeThumbnails = (size: number) => {
      const next = Math.max(view === "grid" ? 220 : 80, Math.min(view === "grid" ? 440 : 192, size));
      setThumbnailSizes((current) => ({ ...current, [view]: next }));
      try {
         localStorage.setItem(`acroclip.library.scale.${view}`, String(next));
      } catch {
         /* Scaling still works without storage. */
      }
   };
   const smallerGridSize = gridZoomTarget(gridMetrics.width, gridMetrics.gap, thumbnailSizes.grid, -1);
   const largerGridSize = gridZoomTarget(gridMetrics.width, gridMetrics.gap, thumbnailSizes.grid, 1);
   const stepThumbnails = (direction: -1 | 1) => {
      if (view === "grid") {
         const target = direction > 0 ? largerGridSize : smallerGridSize;
         if (target !== null) resizeThumbnails(target);
         return;
      }
      const position = (thumbnailSizes.list - 80) / 16;
      resizeThumbnails(80 + (direction > 0 ? Math.floor(position) + 1 : Math.ceil(position) - 1) * 16);
   };
   useEffect(() => {
      try {
         localStorage.setItem("acroclip.library.view", view);
      } catch {
         /* The view still works when storage is unavailable. */
      }
   }, [view]);
   useLayoutEffect(() => {
      const node = scrollArea.current;
      if (!node || !visible) return;
      const observer = new ResizeObserver(([entry]) => {
         if (!entry || entry.contentRect.width < 1) return;
         const { width, height } = entry.contentRect;
         if (view === "list") {
            setGridMetrics((current) => (current.width === width ? current : { ...current, width }));
            setPlaceholderCount(Math.min(24, Math.max(1, Math.ceil(height / ((thumbnailSizes.list * 9) / 16 + 20)))));
            return;
         }
         const gridElement = node.querySelector<HTMLElement>(".clip-grid");
         const gap = gridElement ? Number.parseFloat(getComputedStyle(gridElement).columnGap) || 0 : 18;
         setGridMetrics((current) => (current.width === width && current.gap === gap ? current : { width, gap }));
         const columns = Math.max(1, Math.floor((width + gap) / (thumbnailSizes.grid + gap)));
         const cardHeight = Math.max(205, (((width - (columns - 1) * gap) / columns) * 9) / 16 + 68);
         setPlaceholderCount(Math.min(24, columns * Math.max(1, Math.ceil(height / (cardHeight + gap)))));
      });
      observer.observe(node);
      return () => observer.disconnect();
   }, [visible, view, thumbnailSizes]);
   const sidebar = usePaneSize(layout, { key: "library.sidebar", initial: 230, min: 200, max: 400, reserve: 440, axis: "x" });
   const pending = state.collectionStatus.phase === "loading" || state.collectionStatus.phase === "refreshing";
   const unavailable = state.collectionStatus.phase === "error";
   const initial = state.collectionStatus.phase === "loading" && !state.clips.length;
   const collectionRoot = state.collectionStatus.root || state.preferences.collection;
   const attaCutAvailable = useAttaCutAvailable(visible);
   useEffect(() => {
      if (!visible) return;
      const refresh = () => {
         if (document.visibilityState === "visible") void api.refresh().catch(() => undefined);
      };
      refresh();
      window.addEventListener("focus", refresh);
      document.addEventListener("visibilitychange", refresh);
      return () => {
         window.removeEventListener("focus", refresh);
         document.removeEventListener("visibilitychange", refresh);
      };
   }, [visible, collectionRoot]);
   const [query, setQuery] = useState("");
   const [, refreshAges] = useState(0);
   useEffect(() => {
      if (!visible) return;
      refreshAges((value) => value + 1);
      // Relative dates still advance when unchanged app state is suppressed.
      const timer = window.setInterval(() => refreshAges((value) => value + 1), 5000);
      return () => window.clearInterval(timer);
   }, [visible]);
   const search = query.toLowerCase();
   const summary = useMemo(() => summarizeClips(state.clips), [state.clips]);
   const appKeys = useMemo(() => applicationKeys(state.clips), [state.clips]);
   const activeJobs = useMemo(() => {
      const result = new Map<string, AppState["jobs"][number]>();
      for (const job of state.jobs)
         if (job.kind === "shareable" && ["running", "queued"].includes(job.state) && !result.has(job.clipId)) result.set(job.clipId, job);
      return result;
   }, [state.jobs]);
   const [filter, setFilter] = useState(() => initialLocation("library", "all"));
   useEffect(() => reportLocation("library", filter), [filter]);
   useEffect(() => {
      const restore = (event: Event) => setFilter((event as CustomEvent<NavigationLocation>).detail.library);
      window.addEventListener("acroclip-restore-location", restore);
      return () => window.removeEventListener("acroclip-restore-location", restore);
   }, []);
   const [moveRequest, setMoveRequest] = useState<{ kind: "clip"; id: string } | { kind: "folder"; path: string } | null>(null);
   const [folderContext, setFolderContext] = useState<(ContextMenuRequest & { path: string; origin: "tree" | "tile" }) | null>(null);
   const moveClip = useCallback((id: string) => setMoveRequest({ kind: "clip", id }), []);
   const [order, setOrder] = useState<LibraryOrder>("newest");
   const applicationColors = useApplicationColors(state.applicationIcons, visible);
   const selectedApplicationColor = filter.startsWith("source:") ? applicationColors[filter.slice(7)] : undefined;
   const [contextMenu, setContextMenu] = useState<(ContextMenuRequest & { clipId: string }) | null>(null);
   const [categoryContextMenu, setCategoryContextMenu] = useState<(ContextMenuRequest & { categoryId: string }) | null>(null);
   const requestMenu = useCallback((clipId: string, element: HTMLElement, left: number, top: number) => {
      setContextMenu({ clipId, left, top, restoreFocus: element.querySelector("button") ?? element });
   }, []);
   const closeMenu = useCallback((clipId: string) => setContextMenu((current) => (current?.clipId === clipId ? null : current)), []);
   const previousCollection = useRef(collectionRoot);
   useEffect(() => {
      if (previousCollection.current === collectionRoot) return;
      previousCollection.current = collectionRoot;
      setFilter("all");
      setQuery("");
   }, [collectionRoot]);
   const [addedApplications, setAddedApplications] = useState<Array<{ id: string; name: string }>>([]);
   useEffect(() => {
      let cancelled = false;
      void Promise.all(
         state.preferences.customGames.map(async (game) => {
            const executable = state.platform === "win32" ? game.executable.toLowerCase() : game.executable;
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(executable));
            return { id: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""), name: game.name };
         })
      ).then((items) => {
         if (!cancelled) setAddedApplications(items);
      });
      return () => {
         cancelled = true;
      };
   }, [state.preferences.customGames, state.platform]);
   const applicationCounts = useMemo(() => {
      const counts = new Map<string, number>();
      for (const id of appKeys.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
      return counts;
   }, [appKeys]);
   const sources = useMemo(() => {
      const apps = new Map<string, { id: string; name: string; icon?: string | undefined }>();
      for (const clip of state.clips)
         if (appKeys.has(clip.id) && clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown") {
            const id = appKeys.get(clip.id)!;
            if (!apps.has(id)) apps.set(id, { id, name: normalizeApplicationLabel(clip.source), icon: state.applicationIcons[id] });
         }
      for (const game of addedApplications) apps.set(game.id, { ...game, icon: state.applicationIcons[game.id] });
      return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
   }, [state.clips, state.applicationIcons, appKeys, addedApplications]);
   useEffect(() => {
      if (filter.startsWith("source:") && !sources.some((source) => `source:${source.id}` === filter)) setFilter("all");
      if (filter.startsWith("category:") && !state.categories.some((category) => `category:${category.id}` === filter)) setFilter("all");
   }, [filter, sources, state.categories]);
   const folderPath = filter.startsWith("folder:") ? filter.slice(7) : null;
   const folders = useMemo(() => {
      const found = new Set(state.folders);
      for (const clip of state.clips) {
         const parts = clip.relativePath.replaceAll("\\", "/").split("/");
         for (let i = 1; i < parts.length; i++) found.add(parts.slice(0, i).join("/"));
      }
      return [...found].sort((a, b) => a.localeCompare(b));
   }, [state.folders, state.clips]);
   useEffect(() => {
      if (state.collectionStatus.phase !== "ready" || folderPath === null || !folderPath || folders.includes(folderPath)) return;
      let parent = folderPath;
      do {
         parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
      } while (parent && !folders.includes(parent));
      reportLocation("library", `folder:${parent}`, true);
      setFilter(`folder:${parent}`);
   }, [folderPath, folders, state.collectionStatus.phase]);
   const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
      try {
         const stored: unknown = JSON.parse(localStorage.getItem("acroclip.library.sections") ?? "null");
         return Array.isArray(stored) && stored.every((id): id is string => typeof id === "string") ? stored : [];
      } catch {
         return [];
      }
   });
   const populatedSections = useMemo(
      () => ({ tags: state.categories.length > 0, applications: sources.length > 0, folders: folders.length > 0 }),
      [state.categories.length, sources.length, folders.length]
   );
   const previousSections = useRef<{ root: string; populated: Record<LibrarySectionId, boolean> } | null>(null);
   useLayoutEffect(() => {
      if (state.collectionStatus.phase !== "ready") return;
      const previous = previousSections.current;
      previousSections.current = { root: collectionRoot, populated: populatedSections };
      if (!previous || previous.root !== collectionRoot) return;
      setSectionOrder((order) => {
         const next = orderLibrarySections(populatedSections, order, previous.populated).map((section) => section.id);
         return next.join() ===
            orderLibrarySections(populatedSections, order)
               .map((section) => section.id)
               .join()
            ? order
            : next;
      });
   }, [collectionRoot, populatedSections, state.collectionStatus.phase]);
   useEffect(() => {
      try {
         localStorage.setItem("acroclip.library.sections", JSON.stringify(sectionOrder));
      } catch {
         /* Ordering still works for this session. */
      }
   }, [sectionOrder]);
   const sections = useMemo(() => orderLibrarySections(populatedSections, sectionOrder), [populatedSections, sectionOrder]);
   const [collapsedSections, setCollapsedSections] = useState<string[]>(() => {
      try {
         const stored: unknown = JSON.parse(localStorage.getItem("acroclip.library.collapsed") ?? "[]");
         return Array.isArray(stored) && stored.every((id): id is string => typeof id === "string") ? stored : [];
      } catch {
         return [];
      }
   });
   useEffect(() => {
      try {
         localStorage.setItem("acroclip.library.collapsed", JSON.stringify(collapsedSections));
      } catch {
         /* Folding still works for this session. */
      }
   }, [collapsedSections]);
   useEffect(() => {
      if (state.collectionStatus.phase !== "ready") return;
      setCollapsedSections((current) => {
         const next = current.filter((id) => sections.some((section) => section.id === id && !section.empty));
         return next.length === current.length ? current : next;
      });
   }, [sections, state.collectionStatus.phase]);
   const sectionOpen = (id: LibrarySectionId) => !populatedSections[id] || !collapsedSections.includes(id);
   const reorderSection = (id: string, beforeId: string | null) => {
      const section = sections.find((item) => item.id === id);
      if (!section) return;
      const next = sections.map((item) => item.id).filter((value) => value !== section.id);
      const at = beforeId === null ? next.length : next.findIndex((value) => value === beforeId);
      next.splice(at < 0 ? next.length : at, 0, section.id);
      setSectionOrder(next);
   };
   const folderDropProps = (destination: string) => ({
      onDragOver: (event: DragEvent<HTMLElement>) => {
         if (!event.dataTransfer.types.includes(clipDragType)) return;
         event.preventDefault();
         event.stopPropagation();
         event.dataTransfer.dropEffect = "move";
         event.currentTarget.classList.add("clip-drop-active");
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
         if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
            event.currentTarget.classList.remove("clip-drop-active");
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
         event.currentTarget.classList.remove("clip-drop-active");
         if (!event.dataTransfer.types.includes(clipDragType)) return;
         event.preventDefault();
         event.stopPropagation();
         const id = readCollectionDrag(event.dataTransfer.getData(clipDragType), collectionRoot);
         if (!id || !state.clips.some((clip) => clip.id === id && !clip.originalMissing)) return;
         void run(async () => {
            const moved = await api.moveClip(id, destination);
            reportFeedback({ kind: "notice", message: moved ? "Clip moved" : "Clip is already in this folder", error: false });
         });
      },
   });
   const folderStats = useMemo(() => summarizeFolders(state.clips, search), [state.clips, search]);
   const childFolders = useMemo(() => selectChildFolders(folders, folderPath, search, folderStats, order), [folders, folderPath, search, folderStats, order]);
   const clips = useMemo(
      () => selectLibraryClips(state.clips, { search, filter, folderPath, order, applications: appKeys }),
      [state.clips, search, filter, folderPath, order, appKeys]
   );
   useEffect(() => {
      if (contextMenu && !clips.some((clip) => clip.id === contextMenu.clipId)) setContextMenu(null);
   }, [clips, contextMenu]);
   const selectedCategory = state.categories.find((item) => `category:${item.id}` === filter);
   const headingClipCount = folderPath !== null ? (folderStats.get(folderPath)?.matchingCount ?? 0) : clips.length;
   const discovering = state.collectionStatus.phase === "loading";
   const discovery = state.collectionStatus.discovery;
   const discoveredCount =
      query || (filter !== "all" && folderPath === null)
         ? undefined
         : folderPath === null
           ? discovery?.videos
           : (discovery?.byFolder[folderPath] ?? (discovery?.complete ? 0 : undefined));
   const slots = discovery && discoveredCount !== undefined && (discovery.complete || discoveredCount > 0) ? discoveredCount : placeholderCount;
   const remainingSlots = discovering && !query && discoveredCount !== undefined ? Math.max(0, discoveredCount - clips.length) : 0;
   const showPlaceholders = discovering && !clips.length && !childFolders.length && !query;
   const grid = useRef<HTMLDivElement>(null);
   const captureLayout = useGridMotion(
      grid,
      JSON.stringify([view, gridMetrics.width, thumbnailSizes[view], childFolders, clips.map((clip) => clip.id)]),
      visible,
      JSON.stringify([collectionRoot, filter]),
      view,
      view === "list" && listSizing
   );
   const heading =
      filter === "all"
         ? "All clips"
         : folderPath !== null
           ? folderPath.split("/").at(-1) || folderName(collectionRoot)
           : (selectedCategory?.name ?? sources.find((source) => `source:${source.id}` === filter)?.name ?? filter.slice(filter.indexOf(":") + 1));
   const [editingCategory, setEditingCategory] = useState<Category | "new" | null>(null);
   const createCategory = useCallback(() => {
      setCollapsedSections((current) => current.filter((id) => id !== "tags"));
      setEditingCategory("new");
   }, []);
   const removeCategory = async (id: string, name: string) => {
      if (
         await ask({
            title: `Delete ${name}?`,
            detail: "Deletes the tag. Clips and shareables are kept.",
            confirm: "Delete tag",
            danger: true,
         })
      ) {
         if (await run(() => api.category("delete", { id }))) setFilter("all");
      }
   };
   const followFolder = (previous: string, next: string) => {
      if (folderPath === previous || folderPath?.startsWith(`${previous}/`)) setFilter(`folder:${next}${folderPath.slice(previous.length)}`);
   };
   const createFolder = useCallback(
      async (parent: string) => {
         const name = await ask({ title: "New folder", initial: "", confirm: "Create" });
         if (typeof name !== "string" || !name) return;
         await run(async () => {
            setFilter(`folder:${await api.createFolder(parent, name)}`);
         });
      },
      [ask, run]
   );
   useEffect(() => {
      const command = (event: Event) => {
         const id = (event as CustomEvent<string>).detail;
         if (id === "search") searchInput.current?.focus();
         else if (id === "newCategory") setEditingCategory("new");
         else if (id === "newFolder") void createFolder(folderPath ?? "");
         else if (id === "newFolderRoot") void createFolder("");
         else if (id === "openClip" && clips[0]) openClip(clips[0]);
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
   }, [clips, openClip, createFolder, folderPath]);
   const renameFolder = async (path: string) => {
      const name = await ask({ title: "Rename folder", initial: path.split("/").at(-1)!, confirm: "Rename" });
      if (typeof name !== "string" || !name) return;
      await run(async () => followFolder(path, await api.renameFolder(path, name)));
   };
   const deleteFolder = (path: string) =>
      run(async () => {
         if (await api.deleteFolder(path)) {
            if (folderPath === path || folderPath?.startsWith(`${path}/`)) setFilter(`folder:${path.split("/").slice(0, -1).join("/")}`);
         }
      });
   const requestFolderMenu = (path: string, origin: "tree" | "tile", element: HTMLElement, left: number, top: number) =>
      setFolderContext({ path, origin, left, top, restoreFocus: element });
   const folderMenu = (path: string, origin: "tree" | "tile" | "heading") => (
      <Menu
         label={origin === "heading" ? "Folder actions" : `Actions for folder ${path}`}
         trigger={<MoreHorizontal size={16} />}
         contextRequest={folderContext?.path === path && folderContext.origin === origin ? folderContext : undefined}
         onContextClose={() => setFolderContext((current) => (current?.path === path && current.origin === origin ? null : current))}
      >
         <MenuItem onClick={() => void createFolder(path)}>
            <FolderPlus size={15} />
            New folder
         </MenuItem>
         {path && (
            <>
               <MenuItem onClick={() => void renameFolder(path)}>
                  <Pencil size={15} />
                  Rename folder
               </MenuItem>
               <MenuItem onClick={() => setMoveRequest({ kind: "folder", path })}>
                  <FolderInput size={15} />
                  Move to folder
               </MenuItem>
               <MenuItem danger onClick={() => void deleteFolder(path)}>
                  <Trash2 size={15} />
                  Delete folder
               </MenuItem>
            </>
         )}
      </Menu>
   );
   return (
      <div className="library-page" ref={layout}>
         <aside
            className="library-sidebar navigation-pane"
            style={{
               width: sidebar.size,
               ...(selectedCategory
                  ? { "--selection-background": categoryColors(selectedCategory.color).tint }
                  : selectedApplicationColor
                    ? { "--selection-background": `color-mix(in srgb, ${selectedApplicationColor} 12%, transparent)` }
                    : {}),
            }}
         >
            <div className="collection-drop" {...folderDropProps("")}>
               <ContextHeader
                  className="collection-home"
                  label="Collection"
                  title={folderName(collectionRoot)}
                  icon={<Folder size={17} />}
                  hint={collectionRoot}
                  onTitleClick={() => setFilter("folder:")}
                  actions={
                     <Menu label="Collection actions" trigger={<MoreHorizontal size={17} />}>
                        <MenuItem onClick={() => void run(() => api.reveal(collectionRoot))}>
                           <FolderOpen size={15} />
                           Show in file manager
                        </MenuItem>
                        <MenuItem onClick={openSettings}>
                           <Folder size={15} />
                           Choose collection folder
                        </MenuItem>
                     </Menu>
                  }
               />
            </div>
            <div className="sidebar-scroll moving-selection">
               <SelectionIndicator value={filter} />
               <button className={`sidebar-item ${filter === "all" ? "selected" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  <Grid2X2 size={17} />
                  <span className="sidebar-label">All clips</span>
                  <span className="count">{initial ? "" : state.clips.length}</span>
               </button>
               <MotionList items={sections} identity={collectionRoot} onReorder={reorderSection}>
                  {(section) => (
                     <LibrarySection
                        label={section.label}
                        empty={section.empty}
                        open={sectionOpen(section.id)}
                        toggle={() =>
                           setCollapsedSections((current) =>
                              current.includes(section.id) ? current.filter((id) => id !== section.id) : [...current, section.id]
                           )
                        }
                        action={
                           <IconButton
                              label={section.id === "tags" ? "New tag" : section.id === "applications" ? "Add game" : "New collection folder"}
                              onClick={() => {
                                 setCollapsedSections((current) => current.filter((id) => id !== section.id));
                                 if (section.id === "tags") createCategory();
                                 else if (section.id === "applications") openGames();
                                 else void createFolder("");
                              }}
                           >
                              <Plus size={16} />
                           </IconButton>
                        }
                     >
                        {section.id === "tags" ? (
                           <>
                              <MotionList
                                 items={state.categories}
                                 visible={sectionOpen("tags")}
                                 identity={collectionRoot}
                                 onReorder={(id, beforeId) => run(() => api.reorderCategory(id, beforeId))}
                              >
                                 {(item) => (
                                    <div
                                       className="category-item"
                                       data-empty={!summary.categories.get(item.id) || undefined}
                                       key={item.id}
                                       onContextMenu={(event) => {
                                          event.preventDefault();
                                          setCategoryContextMenu({
                                             categoryId: item.id,
                                             left: event.clientX,
                                             top: event.clientY,
                                             restoreFocus: event.currentTarget.querySelector("button") ?? event.currentTarget,
                                          });
                                       }}
                                    >
                                       <button
                                          data-list-control=""
                                          className={`sidebar-item ${filter === `category:${item.id}` ? "selected" : ""}`}
                                          aria-pressed={filter === `category:${item.id}`}
                                          style={categoryStyle(item.color)}
                                          onClick={() => setFilter(`category:${item.id}`)}
                                       >
                                          <CategoryMark category={item} />
                                          <span className="sidebar-label" title={item.name}>
                                             {item.name}
                                          </span>
                                          <span className="count">{summary.categories.get(item.id) ?? 0}</span>
                                       </button>
                                       <Menu
                                          label={`Actions for ${item.name}`}
                                          trigger={<MoreHorizontal size={14} />}
                                          contextRequest={categoryContextMenu?.categoryId === item.id ? categoryContextMenu : undefined}
                                          onContextClose={() => setCategoryContextMenu((current) => (current?.categoryId === item.id ? null : current))}
                                       >
                                          <MenuItem onClick={() => setEditingCategory(item)}>
                                             <Pencil size={14} />
                                             Edit tag
                                          </MenuItem>
                                          <MenuItem danger onClick={() => void removeCategory(item.id, item.name)}>
                                             <Trash2 size={14} />
                                             Delete tag
                                          </MenuItem>
                                       </Menu>
                                    </div>
                                 )}
                              </MotionList>
                           </>
                        ) : section.id === "applications" ? (
                           <>
                              <MotionList items={sources} identity={collectionRoot} visible={sectionOpen("applications")}>
                                 {(source) => (
                                    <button
                                       key={source.id}
                                       data-empty={!applicationCounts.get(source.id) || undefined}
                                       className={`sidebar-item application-filter ${filter === `source:${source.id}` ? "selected" : ""}`}
                                       style={{ "--application-color": applicationColors[source.id] } as CSSProperties}
                                       aria-pressed={filter === `source:${source.id}`}
                                       onClick={() => setFilter(`source:${source.id}`)}
                                    >
                                       <ApplicationIcon src={source.icon} size={16} />
                                       <span className="sidebar-label" title={source.name}>
                                          {source.name}
                                       </span>
                                       <span className="count">{applicationCounts.get(source.id) ?? 0}</span>
                                    </button>
                                 )}
                              </MotionList>
                           </>
                        ) : (
                           <>
                              {folders.length > 0 && (
                                 <FolderTree
                                    visible={sectionOpen("folders")}
                                    dropProps={folderDropProps}
                                    paths={folders}
                                    counts={folderStats}
                                    selected={folderPath}
                                    onSelect={(path) => setFilter(`folder:${path}`)}
                                    renderActions={(path) => folderMenu(path, "tree")}
                                    requestMenu={(path, element, left, top) => requestFolderMenu(path, "tree", element, left, top)}
                                 />
                              )}
                           </>
                        )}
                     </LibrarySection>
                  )}
               </MotionList>
            </div>
            <div className="sidebar-bottom">
               {initial ? (
                  <span aria-hidden="true">&nbsp;</span>
               ) : (
                  <>
                     {state.clips.length} {state.clips.length === 1 ? "clip" : "clips"} · {formatSize(summary.size)}
                  </>
               )}
            </div>
         </aside>
         <PaneDivider label="Library sidebar width" pane={sidebar} />
         <div className="library-content" style={{ "--grid-thumbnail-size": `${thumbnailSizes.grid}px` } as CSSProperties}>
            <header className="library-heading">
               <div>
                  <div className="library-title-line">
                     <h1>{heading}</h1>
                     {folderPath !== null && folderMenu(folderPath, "heading")}
                  </div>
                  <p>
                     {childFolders.length > 0 && `${childFolders.length} ${childFolders.length === 1 ? "folder" : "folders"} · `}
                     {discovering && discovery && discoveredCount !== undefined ? (
                        `${discoveredCount} videos found`
                     ) : initial ? (
                        <span aria-hidden="true">&nbsp;</span>
                     ) : (
                        <>
                           {headingClipCount} {headingClipCount === 1 ? "clip" : "clips"}
                        </>
                     )}
                  </p>
               </div>
               <div className="library-tools">
                  <span className="library-refresh-status">
                     {unavailable && (
                        <IconButton label={`Collection refresh failed: ${state.collectionStatus.error}. Retry`} onClick={() => void run(() => api.refresh())}>
                           <AlertCircle size={16} />
                        </IconButton>
                     )}
                  </span>
                  <div className="search-input">
                     <Search size={16} />
                     <input
                        ref={searchInput}
                        aria-label="Search clips"
                        spellCheck={false}
                        placeholder="Search clips"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                     />
                     {query && (
                        <IconButton label="Clear search" onClick={() => setQuery("")}>
                           <X size={13} />
                        </IconButton>
                     )}
                  </div>
                  <div className="sort-control">
                     <Select value={order} onChange={(value) => setOrder(value === "name" || value === "oldest" ? value : "newest")} label="Sort clips">
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="name">Name</option>
                     </Select>
                  </div>
                  <div className="library-view-switch moving-selection" role="group" aria-label="Library view">
                     <SelectionIndicator value={view} selector={'button[aria-pressed="true"]'} />
                     <IconButton
                        label="Grid view"
                        aria-pressed={view === "grid"}
                        onClick={() => {
                           if (view !== "grid") {
                              captureLayout();
                              setView("grid");
                           }
                        }}
                     >
                        <Grid2X2 size={16} />
                     </IconButton>
                     <IconButton
                        label="List view"
                        aria-pressed={view === "list"}
                        onClick={() => {
                           if (view !== "list") {
                              captureLayout();
                              setView("list");
                           }
                        }}
                     >
                        <List size={18} />
                     </IconButton>
                  </div>
               </div>
            </header>
            <div className="library-scroll" ref={scrollArea} aria-busy={pending}>
               {folderPath !== null && (
                  <nav className="folder-breadcrumb" aria-label="Folder path">
                     <button onClick={() => setFilter("folder:")}>Collection</button>
                     {folderPath
                        .split("/")
                        .filter(Boolean)
                        .map((part, index, parts) => (
                           <button
                              key={index}
                              aria-current={index === parts.length - 1 ? "page" : undefined}
                              onClick={() => setFilter(`folder:${parts.slice(0, index + 1).join("/")}`)}
                           >
                              <span aria-hidden="true">/</span>
                              {part}
                           </button>
                        ))}
                  </nav>
               )}
               {showPlaceholders ? (
                  <div className="clip-grid library-skeleton" data-view={view} aria-label="Opening collection">
                     {Array.from({ length: slots }, (_, key) => (
                        <div className="clip-placeholder" key={key}>
                           <div />
                           <span />
                        </div>
                     ))}
                  </div>
               ) : clips.length || childFolders.length ? (
                  <div className="clip-grid" data-view={view} ref={grid}>
                     {childFolders.map((path) => (
                        <FolderCard
                           key={`folder:${path}`}
                           path={path}
                           count={folderStats.get(path)?.count ?? 0}
                           dropProps={folderDropProps(path)}
                           actions={folderMenu(path, "tile")}
                           onOpen={(path) => setFilter(`folder:${path}`)}
                           requestMenu={(path, element, left, top) => requestFolderMenu(path, "tile", element, left, top)}
                        />
                     ))}
                     {clips.map((clip) => (
                        <ClipCard
                           createTag={createCategory}
                           key={clip.id}
                           clip={clip}
                           collectionRoot={collectionRoot}
                           ageText={age(clip.createdAt)}
                           job={activeJobs.get(clip.id)}
                           applicationColor={applicationColors[appKeys.get(clip.id) ?? ""]}
                           appIcon={state.applicationIcons[appKeys.get(clip.id) ?? ""]}
                           showSource={!filter.startsWith("source:")}
                           shareSizeMB={state.preferences.shareSizeMB}
                           attaCutAvailable={attaCutAvailable}
                           contextRequest={contextMenu?.clipId === clip.id ? contextMenu : undefined}
                           requestMenu={requestMenu}
                           closeMenu={closeMenu}
                           openClip={openClip}
                           categories={state.categories}
                           moveClip={moveClip}
                           run={run}
                           ask={ask}
                        />
                     ))}
                     {Array.from({ length: remainingSlots }, (_, index) => (
                        <div className="clip-placeholder" key={`pending:${index}`} aria-hidden="true">
                           <div />
                           <span />
                        </div>
                     ))}
                  </div>
               ) : pending ? null : unavailable ? (
                  <Empty icon={<FolderOpen size={38} />} title="Collection unavailable">
                     <Button onClick={() => void run(() => api.refresh())}>Retry</Button>
                  </Empty>
               ) : (
                  <Empty
                     icon={<FolderOpen size={38} />}
                     title={query ? "No matching clips" : folderPath !== null ? "Folder is empty" : "No clips"}
                     detail={
                        query
                           ? "Try another name or application."
                           : folderPath !== null
                             ? "Put supported videos in this folder to see them here."
                             : selectedCategory
                               ? "Tag clips using their actions menu."
                               : filter.startsWith("source:")
                                 ? "Clips recorded from this application appear here."
                                 : "Save a clip while recording, or put supported videos into your collection folder."
                     }
                  >
                     {query && <Button onClick={() => setQuery("")}>Clear search</Button>}
                     {filter !== "all" && (
                        <Button
                           onClick={() => {
                              setFilter("all");
                              setQuery("");
                           }}
                        >
                           Show all clips
                        </Button>
                     )}
                     {filter === "all" && !query && (
                        <Button onClick={() => void run(() => api.reveal(collectionRoot))}>
                           <FolderOpen size={16} />
                           Open collection folder
                        </Button>
                     )}
                  </Empty>
               )}
            </div>
            <div className="library-scale" role="group" aria-label="Thumbnail scale">
               <IconButton
                  label="Smaller thumbnails"
                  onClick={() => stepThumbnails(-1)}
                  disabled={view === "grid" ? smallerGridSize === null : thumbnailSizes.list <= 80}
               >
                  <ZoomOut size={15} />
               </IconButton>
               <Slider
                  variant="compact"
                  aria-label={`${view === "grid" ? "Grid" : "List"} thumbnail size`}
                  aria-valuetext={
                     view === "grid"
                        ? `${gridScale.columns} ${gridScale.columns === 1 ? "column" : "columns"}, ${Math.round(gridScale.pixels)}px thumbnails`
                        : `${thumbnailSizes.list}px thumbnails`
                  }
                  min={view === "grid" ? gridScale.min : 80}
                  max={view === "grid" ? gridScale.max : 192}
                  step={1}
                  value={view === "grid" ? gridScale.value : thumbnailSizes.list}
                  disabled={view === "grid" && gridScale.max === gridScale.min}
                  onValueChange={(value) => resizeThumbnails(view === "grid" ? (gridScale.sizes[value] ?? thumbnailSizes.grid) : value)}
               />
               <IconButton
                  label="Larger thumbnails"
                  onClick={() => stepThumbnails(1)}
                  disabled={view === "grid" ? largerGridSize === null : thumbnailSizes.list >= 192}
               >
                  <ZoomIn size={15} />
               </IconButton>
            </div>
         </div>
         {moveRequest && (
            <MoveDialog
               title={moveRequest.kind === "folder" ? `Move ${moveRequest.path.split("/").at(-1)}` : "Move clip"}
               folders={folders}
               initial={moveRequest.kind === "folder" ? moveRequest.path.split("/").slice(0, -1).join("/") : (folderPath ?? "")}
               excluded={moveRequest.kind === "folder" ? moveRequest.path : undefined}
               close={() => setMoveRequest(null)}
               submit={async (destination) => {
                  if (moveRequest.kind === "folder") {
                     const next = await api.moveFolder(moveRequest.path, destination);
                     if (next === null) return;
                     followFolder(moveRequest.path, next);
                     reportFeedback({ kind: "notice", message: "Folder moved", error: false });
                  } else {
                     const moved = await api.moveClip(moveRequest.id, destination);
                     reportFeedback({ kind: "notice", message: moved ? "Clip moved" : "Clip is already in this folder", error: false });
                  }
               }}
            />
         )}
         {editingCategory && (
            <CategoryEditor category={editingCategory === "new" ? undefined : editingCategory} close={() => setEditingCategory(null)} run={run} />
         )}
      </div>
   );
}
