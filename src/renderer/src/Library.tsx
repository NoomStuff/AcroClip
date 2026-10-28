import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { AlertCircle, Check, Folder, FolderOpen, Grid2X2, List, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { AppState, Category, Clip } from "../../shared/types";
import { DialogPanel } from "./Dialog";
import type { Ask } from "./Dialog";
import { SelectionIndicator } from "./SelectionIndicator";
import { ContextHeader, Button, Empty, IconButton, Menu, MenuItem, Select } from "./ui";
import { api } from "./desktop";
import { age, folderName, formatSize } from "./format";
import type { Run } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { ClipCard } from "./ClipCard";
import { FolderTree } from "./FolderTree";
import { categoryColors, categoryStyle } from "./category-color";
import { CategoryEditor, CategoryMark } from "./CategoryEditor";
import { useGridMotion } from "./useGridMotion";
import { PaneDivider, usePaneSize } from "./layout";
import { useApplicationColors } from "./useApplicationColors";
import type { ContextMenuRequest } from "./ui";
import { useAttaCutAvailable } from "./useAttaCutAvailable";
import { summarizeClips } from "./library-index";

export function Library({
   state,
   visible = true,
   run,
   ask,
   openClip,
   openSettings,
}: {
   state: Pick<AppState, "clips" | "folders" | "applicationIcons" | "categories" | "collectionStatus" | "jobs" | "preferences">;
   visible?: boolean;
   run: Run;
   ask: Ask;
   openClip: (clip: Clip) => void;
   openSettings: () => void;
}) {
   const layout = useRef<HTMLDivElement>(null);
   const scrollArea = useRef<HTMLDivElement>(null);
   const [placeholderCount, setPlaceholderCount] = useState(8);
   const [view, setView] = useState<"grid" | "list">(() => {
      try {
         return localStorage.getItem("acroclip.library.view") === "list" ? "list" : "grid";
      } catch {
         return "grid";
      }
   });
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
            setPlaceholderCount(Math.min(24, Math.max(1, Math.ceil(height / 82))));
            return;
         }
         const columns = Math.max(1, Math.floor((width + 18) / 248));
         const cardHeight = Math.max(205, (((width - (columns - 1) * 18) / columns) * 9) / 16 + 68);
         setPlaceholderCount(Math.min(24, columns * Math.max(1, Math.ceil(height / (cardHeight + 18)))));
      });
      observer.observe(node);
      return () => observer.disconnect();
   }, [visible, view]);
   const sidebar = usePaneSize(layout, { key: "library.sidebar", initial: 245, min: 200, max: 380, reserve: 440, axis: "x" });
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
   const activeJobs = useMemo(() => {
      const result = new Map<string, AppState["jobs"][number]>();
      for (const job of state.jobs)
         if (job.kind === "shareable" && ["running", "queued"].includes(job.state) && !result.has(job.clipId)) result.set(job.clipId, job);
      return result;
   }, [state.jobs]);
   const [filter, setFilter] = useState("all");
   const [order, setOrder] = useState("newest");
   const applicationColors = useApplicationColors(state.applicationIcons, visible);
   const selectedApplicationColor = filter.startsWith("source:") ? applicationColors[filter.slice(7)] : undefined;
   const [contextMenu, setContextMenu] = useState<(ContextMenuRequest & { clipId: string }) | null>(null);
   const [categoryContextMenu, setCategoryContextMenu] = useState<(ContextMenuRequest & { categoryId: string }) | null>(null);
   const requestMenu = useCallback((clipId: string, element: HTMLElement, left: number, top: number) => {
      setContextMenu({ clipId, left, top, restoreFocus: element.querySelector("button") ?? element });
   }, []);
   const closeMenu = useCallback((clipId: string) => setContextMenu((current) => (current?.clipId === clipId ? null : current)), []);
   useEffect(() => {
      setFilter("all");
      setQuery("");
   }, [collectionRoot]);
   const [categoryClip, setCategoryClip] = useState<Clip | null>(null);
   const categoryEdit = useRef<{ clip: Clip; persisted: string[]; pending: Promise<void> } | null>(null);
   const openCategories = useCallback((clip: Clip) => {
      categoryEdit.current = { clip, persisted: clip.categories, pending: Promise.resolve() };
      setCategoryClip(clip);
   }, []);
   const closeCategories = () => {
      categoryEdit.current = null;
      setCategoryClip(null);
   };
   const sources = useMemo(() => {
      const apps = new Map<string, { id: string; name: string; icon?: string | undefined }>();
      for (const clip of state.clips)
         if (clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown") {
            const id = clip.applicationId ?? `label:${clip.source}`;
            if (!apps.has(id))
               apps.set(id, { id, name: clip.source.trim(), icon: clip.applicationId ? state.applicationIcons[clip.applicationId] : undefined });
         }
      return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
   }, [state.clips, state.applicationIcons]);
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
   const folderStats = useMemo(() => {
      const result = new Map<string, { newest: number; oldest: number; matches: boolean }>();
      for (const clip of state.clips) {
         const parts = clip.relativePath.replaceAll("\\", "/").split("/");
         const matches = !search || `${clip.name} ${clip.source}`.toLowerCase().includes(search);
         for (let i = 1; i < parts.length; i++) {
            const path = parts.slice(0, i).join("/"),
               previous = result.get(path);
            result.set(path, {
               newest: Math.max(previous?.newest ?? 0, clip.createdAt),
               oldest: Math.min(previous?.oldest ?? Infinity, clip.createdAt),
               matches: (previous?.matches ?? false) || matches,
            });
         }
      }
      return result;
   }, [state.clips, search]);
   const childFolders = useMemo(
      () =>
         folderPath === null
            ? []
            : folders
                 .filter((path) => {
                    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
                    return parent === folderPath && (!search || path.split("/").at(-1)!.toLowerCase().includes(search) || folderStats.get(path)?.matches);
                 })
                 .sort((a, b) => {
                    if (order === "name") return a.localeCompare(b);
                    const first = folderStats.get(a),
                       second = folderStats.get(b);
                    return (
                       (order === "oldest" ? (first?.oldest ?? 0) - (second?.oldest ?? 0) : (second?.newest ?? 0) - (first?.newest ?? 0)) || a.localeCompare(b)
                    );
                 }),
      [folderPath, folders, search, folderStats, order]
   );
   const clips = useMemo(
      () =>
         state.clips
            .filter(
               (item) =>
                  (!search || `${item.name} ${item.source}`.toLowerCase().includes(search)) &&
                  (filter === "all" ||
                     (filter.startsWith("category:") && item.categories.includes(filter.slice(9))) ||
                     (filter.startsWith("source:") && (item.applicationId ?? `label:${item.source}`) === filter.slice(7)) ||
                     (folderPath !== null && item.relativePath.replaceAll("\\", "/").split("/").slice(0, -1).join("/") === folderPath))
            )
            .sort((a, b) => (order === "name" ? a.name.localeCompare(b.name) : order === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)),
      [state.clips, search, filter, folderPath, order]
   );
   useEffect(() => {
      if (contextMenu && !clips.some((clip) => clip.id === contextMenu.clipId)) setContextMenu(null);
   }, [clips, contextMenu]);
   const selectedCategory = state.categories.find((item) => `category:${item.id}` === filter);
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
   useGridMotion(grid, JSON.stringify([collectionRoot, view, childFolders, clips.map((clip) => clip.id)]), visible);
   const heading =
      filter === "all"
         ? "All clips"
         : folderPath !== null
           ? folderPath.split("/").at(-1) || folderName(collectionRoot)
           : (selectedCategory?.name ?? sources.find((source) => `source:${source.id}` === filter)?.name ?? filter.slice(filter.indexOf(":") + 1));
   const [editingCategory, setEditingCategory] = useState<Category | "new" | null>(null);
   const createCategory = () => setEditingCategory("new");
   useEffect(() => {
      const command = (event: Event) => {
         const id = (event as CustomEvent<string>).detail;
         if (id === "search") layout.current?.querySelector<HTMLInputElement>('input[aria-label="Search clips"]')?.focus();
         else if (id === "newCategory") setEditingCategory("new");
         else if (id === "openClip" && clips[0]) openClip(clips[0]);
      };
      window.addEventListener("acroclip-shortcut", command);
      return () => window.removeEventListener("acroclip-shortcut", command);
   }, [clips, openClip, run]);
   const removeCategory = async (id: string, name: string) => {
      if (
         await ask({
            title: `Delete ${name}?`,
            detail: "Deletes the category without deleting its clips or shareables.",
            confirm: "Delete category",
            danger: true,
         })
      ) {
         if (await run(() => api.category("delete", { id }))) setFilter("all");
      }
   };
   const assign = (id: string) => {
      const edit = categoryEdit.current;
      if (!edit) return;
      const ids = edit.clip.categories.includes(id) ? edit.clip.categories.filter((item) => item !== id) : [...edit.clip.categories, id];
      edit.clip = { ...edit.clip, categories: ids };
      setCategoryClip(edit.clip);
      // Keep accepted selections ordered even if the dialog closes before disk writes finish.
      edit.pending = edit.pending.then(async () => {
         if (await run(() => api.category("assign", { clipId: edit.clip.id, categoryIds: ids }))) {
            edit.persisted = ids;
         } else if (categoryEdit.current === edit && edit.clip.categories === ids) {
            edit.clip = { ...edit.clip, categories: edit.persisted };
            setCategoryClip(edit.clip);
         }
      });
   };
   return (
      <div className="library-page" ref={layout}>
         <aside
            className="library-sidebar"
            style={{
               width: sidebar.size,
               ...(selectedCategory
                  ? { "--selection-background": categoryColors(selectedCategory.color).tint }
                  : selectedApplicationColor
                    ? { "--selection-background": `color-mix(in srgb, ${selectedApplicationColor} 12%, transparent)` }
                    : {}),
            }}
         >
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
                        Choose folder in settings
                     </MenuItem>
                  </Menu>
               }
            />
            <div className="sidebar-scroll moving-selection">
               <SelectionIndicator value={filter} />
               <button className={`sidebar-item ${filter === "all" ? "selected" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  <Grid2X2 size={17} />
                  <span className="sidebar-label">All clips</span>
                  <span className="count">{initial ? "" : state.clips.length}</span>
               </button>
               <div className="sidebar-group-title">
                  <span>Categories</span>
                  <IconButton label="New category" onClick={() => void createCategory()}>
                     <Plus size={16} />
                  </IconButton>
               </div>
               {state.categories.map((item) => (
                  <div
                     className="category-item"
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
                           Edit category
                        </MenuItem>
                        <div className="menu-separator" role="separator" />
                        <MenuItem danger onClick={() => void removeCategory(item.id, item.name)}>
                           <Trash2 size={14} />
                           Delete category
                        </MenuItem>
                     </Menu>
                  </div>
               ))}
               {sources.length > 0 && (
                  <>
                     <div className="sidebar-group-title">Applications</div>
                     {sources.map((source) => (
                        <button
                           key={source.id}
                           className={`sidebar-item application-filter ${filter === `source:${source.id}` ? "selected" : ""}`}
                           style={{ "--application-color": applicationColors[source.id] } as CSSProperties}
                           aria-pressed={filter === `source:${source.id}`}
                           onClick={() => setFilter(`source:${source.id}`)}
                        >
                           <ApplicationIcon src={source.icon} size={16} />
                           <span className="sidebar-label" title={source.name}>
                              {source.name}
                           </span>
                        </button>
                     ))}
                  </>
               )}
               {folders.length > 0 && (
                  <>
                     <div className="sidebar-group-title">Folders</div>
                     <FolderTree paths={folders} selected={folderPath} onSelect={(path) => setFilter(`folder:${path}`)} />
                  </>
               )}
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
         <div className="library-content">
            <header className="library-heading">
               <div>
                  <h1>{heading}</h1>
                  <p>
                     {childFolders.length > 0 && `${childFolders.length} ${childFolders.length === 1 ? "folder" : "folders"} · `}
                     {discovering && discovery && discoveredCount !== undefined ? (
                        `${discoveredCount} videos found`
                     ) : initial ? (
                        <span aria-hidden="true">&nbsp;</span>
                     ) : (
                        <>
                           {clips.length} {clips.length === 1 ? "clip" : "clips"}
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
                     <input aria-label="Search clips" placeholder="Search clips" value={query} onChange={(event) => setQuery(event.target.value)} />
                     {query && (
                        <IconButton label="Clear search" onClick={() => setQuery("")}>
                           <X size={13} />
                        </IconButton>
                     )}
                  </div>
                  <div className="sort-control">
                     <Select value={order} onChange={setOrder} label="Sort clips">
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="name">Name</option>
                     </Select>
                  </div>
                  <div className="library-view-switch moving-selection" role="group" aria-label="Library view">
                     <SelectionIndicator value={view} selector={'button[aria-pressed="true"]'} />
                     <IconButton label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                        <Grid2X2 size={16} />
                     </IconButton>
                     <IconButton label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
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
                        <article className="clip-card folder-card" key={`folder:${path}`} data-layout-key={`folder:${path}`}>
                           <button className="clip-open" aria-label={`Open folder ${path}`} onClick={() => setFilter(`folder:${path}`)}>
                              <div className="clip-thumbnail">
                                 <Folder size={58} />
                              </div>
                              <div className="clip-card-info">
                                 <strong>{path.split("/").at(-1)}</strong>
                              </div>
                           </button>
                        </article>
                     ))}
                     {clips.map((clip) => (
                        <ClipCard
                           key={clip.id}
                           clip={clip}
                           ageText={age(clip.createdAt)}
                           job={activeJobs.get(clip.id)}
                           applicationColor={clip.applicationId ? applicationColors[clip.applicationId] : undefined}
                           appIcon={clip.applicationId ? state.applicationIcons[clip.applicationId] : undefined}
                           showSource={!filter.startsWith("source:")}
                           shareSizeMB={state.preferences.shareSizeMB}
                           attaCutAvailable={attaCutAvailable}
                           contextRequest={contextMenu?.clipId === clip.id ? contextMenu : undefined}
                           requestMenu={requestMenu}
                           closeMenu={closeMenu}
                           openClip={openClip}
                           openCategories={openCategories}
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
                               ? "Add clips to this category using their actions menu."
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
         </div>
         {editingCategory && (
            <CategoryEditor category={editingCategory === "new" ? undefined : editingCategory} close={() => setEditingCategory(null)} run={run} />
         )}
         {categoryClip && (
            <DialogPanel title="Categories" label="Clip categories" close={closeCategories} className="category-dialog" closeLabel="Close categories">
               <p>{categoryClip.name}</p>
               {state.categories.length ? (
                  state.categories.map((item) => (
                     <button
                        key={item.id}
                        className="category-option"
                        aria-pressed={categoryClip.categories.includes(item.id)}
                        style={categoryStyle(item.color)}
                        onClick={() => void assign(item.id)}
                     >
                        <CategoryMark category={item} size={17} />
                        {item.name}
                        {categoryClip.categories.includes(item.id) && <Check size={17} />}
                     </button>
                  ))
               ) : (
                  <p>Create a category in the Library sidebar first.</p>
               )}
               <Button className="primary" onClick={closeCategories}>
                  Done
               </Button>
            </DialogPanel>
         )}
      </div>
   );
}
