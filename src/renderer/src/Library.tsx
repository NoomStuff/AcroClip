import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
   AlertCircle,
   Check,
   Clapperboard,
   Folder,
   FolderOpen,
   Grid2X2,
   List,
   LoaderCircle,
   MoreHorizontal,
   Pencil,
   Plus,
   Search,
   Share2,
   Tag,
   Trash2,
   X,
} from "lucide-react";
import type { AppState, Category, Clip } from "../../shared/types";
import { DialogPanel } from "./Dialog";
import type { Ask } from "./Dialog";
import { SelectionIndicator } from "./SelectionIndicator";
import { ContextHeader, Button, Empty, IconButton, Menu, MenuItem, Select } from "./ui";
import { fileDragProps, api } from "./desktop";
import { age, folderName, formatSize, formatTime } from "./format";
import type { Run } from "./desktop";
import { ApplicationIcon } from "./ApplicationIcon";
import { FolderTree } from "./FolderTree";
import { categoryColors, categoryStyle } from "./category-color";
import { CategoryEditor, CategoryMark } from "./CategoryEditor";
import { useGridMotion } from "./useGridMotion";
import { PaneDivider, usePaneSize } from "./layout";
import { useApplicationColors } from "./useApplicationColors";
import type { ContextMenuRequest } from "./ui";

function applicationStyle(color: string | undefined): CSSProperties {
   return color ? ({ "--application-color": color } as CSSProperties) : {};
}

export function Library({
   state,
   visible = true,
   run,
   ask,
   openClip,
   openSettings,
}: {
   state: AppState;
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
   const [query, setQuery] = useState("");
   const [filter, setFilter] = useState("all");
   const [order, setOrder] = useState("newest");
   const applicationColors = useApplicationColors(state.applicationIcons, visible);
   const selectedApplicationColor = filter.startsWith("source:") ? applicationColors[filter.slice(7)] : undefined;
   const [contextMenu, setContextMenu] = useState<(ContextMenuRequest & { clipId: string }) | null>(null);
   const requestMenu = (clipId: string, element: HTMLElement, left: number, top: number) => {
      setContextMenu({ clipId, left, top, restoreFocus: element.querySelector("button") ?? element });
   };
   useEffect(() => {
      setFilter("all");
      setQuery("");
   }, [collectionRoot]);
   const [categoryClip, setCategoryClip] = useState<Clip | null>(null);
   const categoryEdit = useRef<{ clip: Clip; persisted: string[]; pending: Promise<void> } | null>(null);
   const openCategories = (clip: Clip) => {
      categoryEdit.current = { clip, persisted: clip.categories, pending: Promise.resolve() };
      setCategoryClip(clip);
   };
   const closeCategories = () => {
      categoryEdit.current = null;
      setCategoryClip(null);
   };
   const sources = useMemo(() => {
      const apps = new Map<string, { id: string; name: string; icon?: string | undefined }>();
      for (const clip of state.clips)
         if (clip.source) {
            const id = clip.applicationId ?? `label:${clip.source}`;
            if (!apps.has(id)) apps.set(id, { id, name: clip.source, icon: clip.applicationId ? state.applicationIcons[clip.applicationId] : undefined });
         }
      return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
   }, [state.clips, state.applicationIcons]);
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
         const matches = !query || `${clip.name} ${clip.source}`.toLowerCase().includes(query.toLowerCase());
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
   }, [state.clips, query]);
   const childFolders = useMemo(
      () =>
         folderPath === null
            ? []
            : folders
                 .filter((path) => {
                    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
                    return (
                       parent === folderPath &&
                       (!query || path.split("/").at(-1)!.toLowerCase().includes(query.toLowerCase()) || folderStats.get(path)?.matches)
                    );
                 })
                 .sort((a, b) => {
                    if (order === "name") return a.localeCompare(b);
                    const first = folderStats.get(a),
                       second = folderStats.get(b);
                    return (
                       (order === "oldest" ? (first?.oldest ?? 0) - (second?.oldest ?? 0) : (second?.newest ?? 0) - (first?.newest ?? 0)) || a.localeCompare(b)
                    );
                 }),
      [folderPath, folders, query, folderStats, order]
   );
   const clips = useMemo(
      () =>
         state.clips
            .filter(
               (item) =>
                  (!query || `${item.name} ${item.source}`.toLowerCase().includes(query.toLowerCase())) &&
                  (filter === "all" ||
                     (filter.startsWith("category:") && item.categories.includes(filter.slice(9))) ||
                     (filter.startsWith("source:") && (item.applicationId ?? `label:${item.source}`) === filter.slice(7)) ||
                     (folderPath !== null && item.relativePath.replaceAll("\\", "/").split("/").slice(0, -1).join("/") === folderPath))
            )
            .sort((a, b) => (order === "name" ? a.name.localeCompare(b.name) : order === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)),
      [state.clips, query, filter, folderPath, order]
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
         else if (id === "refresh") void run(() => api.refresh());
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
   const rename = async (clip: Clip) => {
      const name = await ask({ title: "Rename clip", confirm: "Rename", initial: clip.name });
      if (typeof name === "string" && name) await run(() => api.renameClip(clip.id, name));
   };
   const remove = async (clip: Clip) => {
      // The main process owns confirmation and trashing, so every entry point gets one prompt.
      await run(() => api.deleteClip(clip.id));
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
               icon={<Folder size={20} />}
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
                     <MenuItem onClick={() => void run(() => api.refresh())}>
                        <Grid2X2 size={15} />
                        Refresh collection
                     </MenuItem>
                  </Menu>
               }
            />
            <div className="sidebar-scroll moving-selection">
               <SelectionIndicator value={filter} />
               <button className={`sidebar-item ${filter === "all" ? "selected" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  <Grid2X2 size={17} />
                  All clips<span className="count">{initial ? "" : state.clips.length}</span>
               </button>
               <div className="sidebar-group-title">
                  Categories
                  <IconButton label="New category" onClick={() => void createCategory()}>
                     <Plus size={14} />
                  </IconButton>
               </div>
               {state.categories.map((item) => (
                  <div className="category-item" key={item.id}>
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
                        <span className="count">{state.clips.filter((clip) => clip.categories.includes(item.id)).length}</span>
                     </button>
                     <Menu label={`Actions for ${item.name}`} trigger={<MoreHorizontal size={14} />}>
                        <MenuItem onClick={() => setEditingCategory(item)}>
                           <Pencil size={14} />
                           Edit category
                        </MenuItem>
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
                           style={applicationStyle(applicationColors[source.id])}
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
                     {state.clips.length} {state.clips.length === 1 ? "clip" : "clips"} · {formatSize(state.clips.reduce((sum, item) => sum + item.size, 0))}
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
                  <div className="library-view-switch" role="group" aria-label="Library view">
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
                     {clips.map((clip) => {
                        const job = state.jobs.find(
                           (item) => item.clipId === clip.id && item.kind === "shareable" && ["running", "queued"].includes(item.state)
                        );
                        const shareable = clip.shareables.at(-1);
                        return (
                           <article
                              className="clip-card"
                              key={clip.id}
                              data-layout-key={clip.id}
                              style={applicationStyle(clip.applicationId ? applicationColors[clip.applicationId] : undefined)}
                              onContextMenu={(event) => {
                                 event.preventDefault();
                                 requestMenu(clip.id, event.currentTarget, event.clientX, event.clientY);
                              }}
                              onKeyDown={(event) => {
                                 if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                                 event.preventDefault();
                                 event.stopPropagation();
                                 const bounds = event.currentTarget.getBoundingClientRect();
                                 requestMenu(clip.id, event.currentTarget, bounds.left + 20, bounds.top + 30);
                              }}
                           >
                              <button
                                 className="clip-open"
                                 {...fileDragProps(clip.originalMissing ? shareable?.path : clip.path)}
                                 onClick={() => openClip(clip)}
                                 aria-label={`Open ${clip.name}`}
                                 title={clip.availability === "unverified" ? "Checking file availability" : undefined}
                              >
                                 <div className="clip-thumbnail">
                                    {clip.thumbnail ? (
                                       <img
                                          src={clip.thumbnail}
                                          alt=""
                                          loading="lazy"
                                          className={clip.height > clip.width ? "portrait-thumbnail" : undefined}
                                       />
                                    ) : (
                                       <div className="thumbnail-fallback">
                                          <Clapperboard size={34} />
                                       </div>
                                    )}
                                    {clip.duration > 0 && <span className="duration">{formatTime(clip.duration)}</span>}
                                    {shareable && (
                                       <span className="copy-indicator" title={`${clip.shareables.length} shareable${clip.shareables.length === 1 ? "" : "s"}`}>
                                          <Share2 size={12} />
                                       </span>
                                    )}
                                    {job && (
                                       <div className="thumbnail-progress">
                                          <span style={{ width: `${job.progress * 100}%` }} />
                                       </div>
                                    )}
                                 </div>
                                 <div className="clip-card-info">
                                    <h3 title={clip.name}>{clip.name}</h3>
                                    <p>
                                       {!filter.startsWith("source:") && clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown" && (
                                          <>
                                             <span className="clip-source-label">
                                                {clip.applicationId && state.applicationIcons[clip.applicationId] && (
                                                   <ApplicationIcon src={state.applicationIcons[clip.applicationId]} size={14} />
                                                )}
                                                <span>{clip.source}</span>
                                             </span>
                                          </>
                                       )}
                                       <span className="clip-age">{age(clip.createdAt)}</span>
                                       <span className="clip-grid-size">
                                          <span aria-hidden="true">&middot;</span>{" "}
                                          {formatSize(clip.originalMissing ? (shareable?.size ?? clip.size) : clip.size)}
                                       </span>
                                    </p>
                                 </div>
                                 <span className="clip-file-facts">
                                    <span>{clip.duration > 0 ? formatTime(clip.duration) : ""}</span>
                                    <span>{formatSize(clip.originalMissing ? (shareable?.size ?? clip.size) : clip.size)}</span>
                                 </span>
                              </button>
                              <div className="card-menu">
                                 <Menu
                                    label={`Actions for ${clip.name}`}
                                    trigger={<MoreHorizontal size={17} />}
                                    contextRequest={contextMenu?.clipId === clip.id ? contextMenu : undefined}
                                    onContextClose={() => setContextMenu((current) => (current?.clipId === clip.id ? null : current))}
                                 >
                                    <MenuItem onClick={() => openClip(clip)}>
                                       <Clapperboard size={15} />
                                       Open clip
                                    </MenuItem>
                                    <MenuItem disabled={!!job || !!clip.originalMissing} onClick={() => void run(() => api.createShareable(clip.id))}>
                                       <Share2 size={15} />
                                       {job ? "Creating shareable…" : "Create shareable"}
                                    </MenuItem>
                                    {shareable && (
                                       <MenuItem onClick={() => void run(() => api.reveal(shareable.path))}>
                                          <FolderOpen size={15} />
                                          Show shareable in folder
                                       </MenuItem>
                                    )}
                                    <MenuItem onClick={() => openCategories(clip)}>
                                       <Tag size={15} />
                                       Categories
                                    </MenuItem>
                                    <MenuItem disabled={!!clip.originalMissing} onClick={() => void rename(clip)}>
                                       <Pencil size={15} />
                                       Rename
                                    </MenuItem>
                                    <MenuItem disabled={!!clip.originalMissing} onClick={() => void run(() => api.reveal(clip.path))}>
                                       <Folder size={15} />
                                       Show original in folder
                                    </MenuItem>
                                    <div className="menu-separator" />
                                    <MenuItem danger onClick={() => void remove(clip)}>
                                       <Trash2 size={15} />
                                       Delete clip
                                    </MenuItem>
                                 </Menu>
                              </div>
                              {job && (
                                 <div className="card-job">
                                    <LoaderCircle size={12} className="spin" />
                                    <span>{job.state === "queued" ? "Queued" : "Creating shareable"}</span>
                                    <span className="tabular">{Math.round(job.progress * 100)}%</span>
                                    <IconButton label="Cancel shareable" onClick={() => void run(() => api.cancelJob(job.id))}>
                                       <X size={12} />
                                    </IconButton>
                                 </div>
                              )}
                           </article>
                        );
                     })}
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
