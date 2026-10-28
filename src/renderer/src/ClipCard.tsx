import { memo } from "react";
import type { CSSProperties } from "react";
import { Clapperboard, FolderOpen, LoaderCircle, MoreHorizontal, Pencil, Scissors, Share2, Tag, Trash2, X } from "lucide-react";
import type { Clip, Job } from "../../shared/types";
import { shareableTargetAllowed } from "../../shared/shareable-target";
import { api, fileDragProps } from "./desktop";
import type { Run } from "./desktop";
import type { Ask } from "./Dialog";
import { formatSize, formatTime } from "./format";
import { ApplicationIcon } from "./ApplicationIcon";
import { IconButton, Menu, MenuItem } from "./ui";
import type { ContextMenuRequest } from "./ui";

export const ClipCard = memo(function ClipCard({
   clip,
   ageText,
   job,
   applicationColor,
   appIcon,
   showSource,
   shareSizeMB,
   attaCutAvailable,
   contextRequest,
   requestMenu,
   closeMenu,
   openClip,
   openCategories,
   run,
   ask,
}: {
   clip: Clip;
   ageText: string;
   job: Job | undefined;
   applicationColor: string | undefined;
   appIcon: string | undefined;
   showSource: boolean;
   shareSizeMB: number;
   attaCutAvailable: boolean;
   contextRequest: ContextMenuRequest | undefined;
   requestMenu: (clipId: string, element: HTMLElement, left: number, top: number) => void;
   closeMenu: (clipId: string) => void;
   openClip: (clip: Clip) => void;
   openCategories: (clip: Clip) => void;
   run: Run;
   ask: Ask;
}) {
   const shareable = clip.shareables.at(-1);
   const rename = async (clip: Clip) => {
      const name = await ask({ title: "Rename clip", confirm: "Rename", initial: clip.name });
      if (typeof name === "string" && name) await run(() => api.renameClip(clip.id, name));
   };
   const remove = async (clip: Clip) => {
      // The main process owns confirmation and trashing for every entry point.
      await run(() => api.deleteClip(clip.id));
   };
   return (
      <article
         className="clip-card"
         data-layout-key={clip.id}
         style={{ "--application-color": applicationColor } as CSSProperties}
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
                  <img src={clip.thumbnail} alt="" loading="lazy" className={clip.height > clip.width ? "portrait-thumbnail" : undefined} />
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
                  {showSource && clip.source.trim() && clip.source.trim().toLowerCase() !== "unknown" && (
                     <>
                        <span className="clip-source-label">
                           {clip.applicationId && appIcon && <ApplicationIcon src={appIcon} size={14} />}
                           <span>{clip.source}</span>
                        </span>
                     </>
                  )}
                  <span className="clip-age">{ageText}</span>
                  <span className="clip-grid-size">
                     <span aria-hidden="true">&middot;</span> {formatSize(clip.originalMissing ? (shareable?.size ?? clip.size) : clip.size)}
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
               contextRequest={contextRequest}
               onContextClose={() => closeMenu(clip.id)}
            >
               <MenuItem onClick={() => openClip(clip)}>
                  <Clapperboard size={15} />
                  Open clip
               </MenuItem>
               <MenuItem
                  disabled={!!job || !!clip.originalMissing || !shareableTargetAllowed(clip.size, shareSizeMB)}
                  onClick={() => void run(() => api.createShareable(clip.id))}
               >
                  <Share2 size={15} />
                  {job ? "Creating shareable…" : "Create shareable"}
               </MenuItem>
               <div className="menu-separator" role="separator" />
               <MenuItem disabled={!!clip.originalMissing || !!job} onClick={() => void rename(clip)}>
                  <Pencil size={15} />
                  Rename clip
               </MenuItem>
               <MenuItem onClick={() => openCategories(clip)}>
                  <Tag size={15} />
                  Categories
               </MenuItem>
               <div className="menu-separator" role="separator" />
               <MenuItem disabled={!!clip.originalMissing} onClick={() => void run(() => api.reveal(clip.path))}>
                  <FolderOpen size={15} />
                  Show clip in folder
               </MenuItem>
               {shareable && (
                  <MenuItem onClick={() => void run(() => api.reveal(shareable.path))}>
                     <FolderOpen size={15} />
                     Show shareable in folder
                  </MenuItem>
               )}
               {attaCutAvailable && !clip.originalMissing && (
                  <MenuItem onClick={() => void run(() => api.openInAttaCut(clip.id))}>
                     <Scissors size={15} />
                     Open in AttaCut
                  </MenuItem>
               )}
               <div className="menu-separator" role="separator" />
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
});
