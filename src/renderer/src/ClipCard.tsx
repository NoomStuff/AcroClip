import { memo } from "react";
import { useThumbnailVisibility } from "./useThumbnailVisibility";
import { useKeyframeScrub } from "./useKeyframeScrub";
import type { CSSProperties } from "react";
import { Clapperboard, LoaderCircle, MoreHorizontal, Play, Share2, X } from "lucide-react";
import type { Category, Clip, Job } from "../../shared/types";
import { shareableTargetAllowed } from "../../shared/shareable-target";
import { api, fileDragProps } from "./desktop";
import type { Run } from "./desktop";
import type { Ask } from "./Dialog";
import { formatSize, formatTime } from "./format";
import { ApplicationIcon } from "./ApplicationIcon";
import { IconButton, Menu, MenuItem } from "./ui";
import { ClipActions } from "./ClipActions";
import { defaultClipFile } from "./clip-files";
import type { ContextMenuRequest } from "./ui";

const dragSurface = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')}`;

export const ClipCard = memo(function ClipCard({
   clip,
   collectionRoot,
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
   categories,
   createTag,
   moveClip,
   run,
   ask,
}: {
   clip: Clip;
   collectionRoot: string;
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
   categories: Category[];
   createTag: () => void;
   moveClip: (id: string) => void;
   run: Run;
   ask: Ask;
}) {
   const shareable = clip.shareables.at(-1);
   // Dragging out shares the same file Copy file would.
   const dragPath = defaultClipFile(clip)?.path;
   const thumbnail = useThumbnailVisibility();
   const scrub = useKeyframeScrub(clip, clip.duration > 0 && !clip.originalMissing && !job);
   return (
      <article
         className="clip-card"
         data-layout-key={clip.id}
         style={{ "--application-color": applicationColor } as CSSProperties}
         // Anywhere on a grid card scrubs, mapped across the thumbnail's width. A list row is mostly
         // text, so there only the thumbnail itself does.
         onPointerMove={(event) => {
            const frame = event.currentTarget.querySelector(".clip-thumbnail")?.getBoundingClientRect();
            if (event.pointerType !== "mouse" || event.buttons || !frame) return;
            const row = !!event.currentTarget.closest('.clip-grid[data-view="list"]');
            const inside = event.clientY >= frame.top && event.clientY <= frame.bottom && event.clientX >= frame.left && event.clientX <= frame.right;
            scrub.setPosition(!row || inside ? Math.min(1, Math.max(0, (event.clientX - frame.left) / frame.width)) : null);
         }}
         onPointerLeave={() => scrub.setPosition(null)}
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
            {...fileDragProps(dragPath, !clip.originalMissing && !job ? { id: clip.id, collection: collectionRoot } : undefined)}
            onClick={() => openClip(clip)}
            aria-label={`Open ${clip.name}`}
         >
            <div className="clip-thumbnail" ref={thumbnail.ref} data-scrubbing={scrub.shown || undefined}>
               {/* Under the thumbnail, which zooms and fades away to reveal it. */}
               <canvas ref={scrub.canvas} className="clip-scrub" aria-hidden="true" />
               {clip.thumbnail ? (
                  thumbnail.visible ? (
                     <img src={clip.thumbnail} alt="" loading="lazy" decoding="async" className={clip.height > clip.width ? "portrait-thumbnail" : undefined} />
                  ) : null
               ) : (
                  <div className="thumbnail-fallback">
                     <Clapperboard size={34} />
                  </div>
               )}
               {clip.duration > 0 && (
                  <span className="duration" data-scrubbing={scrub.frame !== null || undefined}>
                     {scrub.frame !== null ? (
                        <>
                           {formatTime((scrub.frame * clip.duration) / scrub.frames)}
                           <span> / {formatTime(clip.duration)}</span>
                        </>
                     ) : (
                        formatTime(clip.duration)
                     )}
                  </span>
               )}
               {shareable && (
                  <span className="copy-indicator" data-tooltip={`${clip.shareables.length} shareable${clip.shareables.length === 1 ? "" : "s"}`}>
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
               <h3 data-tooltip={clip.name} data-tooltip-overflow="">
                  {clip.name}
               </h3>
               <p className={job ? "card-job" : undefined}>
                  {job ? (
                     <>
                        <LoaderCircle size={12} className="spin" />
                        <span>{job.state === "queued" ? "Queued" : "Creating shareable"}</span>
                        <span className="tabular">{Math.round(job.progress * 100)}%</span>
                     </>
                  ) : (
                     <>
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
                     </>
                  )}
               </p>
            </div>
            <span className="clip-file-facts">
               <span>{clip.duration > 0 ? formatTime(clip.duration) : ""}</span>
               <span>{formatSize(clip.originalMissing ? (shareable?.size ?? clip.size) : clip.size)}</span>
            </span>
            {/* Chromium can turn Shift-drag on a button into text selection.
                A stable image target also works before the thumbnail loads. */}
            <img className="clip-drag-surface" src={dragSurface} alt="" aria-hidden="true" draggable={!!dragPath} />
         </button>
         <div className="card-menu">
            <Menu
               label={`Actions for ${clip.name}`}
               trigger={<MoreHorizontal size={17} />}
               contextRequest={contextRequest}
               onContextClose={() => closeMenu(clip.id)}
            >
               <MenuItem onClick={() => openClip(clip)}>
                  <Play size={15} />
                  Open clip
               </MenuItem>
               <ClipActions
                  createTag={createTag}
                  clip={clip}
                  categories={categories}
                  busy={!!job}
                  canCreate={shareableTargetAllowed(clip.size, shareSizeMB)}
                  attaCutAvailable={attaCutAvailable}
                  ask={ask}
                  run={run}
                  create={() => void run(() => api.createShareable(clip.id))}
                  move={() => moveClip(clip.id)}
               />
            </Menu>
         </div>
         {job && (
            <IconButton className="card-job-cancel" label="Cancel shareable" onClick={() => void run(() => api.cancelJob(job.id))}>
               <X size={12} />
            </IconButton>
         )}
      </article>
   );
});
