import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useKeyframeScrub } from "./useKeyframeScrub";
import { useThumbnailImage } from "./useThumbnailImage";
import type { CSSProperties } from "react";
import { Clapperboard, Eye, LoaderCircle, MoreHorizontal, Play, Share2, X } from "lucide-react";
import type { Category, Clip, Job } from "../../shared/types";
import { shareableTargetAllowed } from "../../shared/shareable-target";
import { api, fileDragProps } from "./desktop";
import type { Run } from "./desktop";
import type { Ask } from "./Dialog";
import { formatSize, formatTime } from "./format";
import { ApplicationIcon } from "./ApplicationIcon";
import { IconButton, Menu, MenuItem } from "./ui";
import { ClipActions } from "./ClipActions";
import { CategoryMark } from "./CategoryEditor";
import { TagArrival, useNewTags } from "./tag-arrival";
import { defaultClipFile } from "./clip-files";
import type { ContextMenuRequest } from "./ui";

/** The clip's length, which opens up to show the scrubbed position before it while previewing. */
function Duration({ duration, position }: { duration: number; position: number | null }) {
   // The last position stays in place while the label closes, so it doesn't empty out mid-animation.
   const shown = useRef(position ?? 0);
   if (position !== null) shown.current = position;
   // The label opens to the position's measured width. Tabular digits keep it steady while scrubbing, so it
   // only changes with the digit count or a font swap. An exact width keeps the total from drifting.
   const text = useRef<HTMLSpanElement>(null);
   const [width, setWidth] = useState(0);
   useLayoutEffect(() => {
      const node = text.current;
      if (!node) return;
      const measure = () => setWidth(node.offsetWidth);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
   }, []);
   return (
      <span className="duration" data-scrubbing={position !== null || undefined} style={{ "--position-width": `${width}px` } as CSSProperties}>
         <span className="duration-position" aria-hidden={position === null || undefined}>
            <span ref={text}>
               {formatTime(shown.current)}
               <span className="duration-divider"> / </span>
            </span>
         </span>
         <span className="duration-total">{formatTime(duration)}</span>
      </span>
   );
}

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
   trimClip,
   categories,
   createTag,
   watchedAt,
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
   trimClip: (clip: Clip) => void;
   categories: Category[];
   /** Opens the tag editor, which applies the new tag to this clip. */
   createTag: (clipId: string) => void;
   /** Set on the clip just left in the player: how far into it playback was, from 0 to 1. */
   watchedAt: number | undefined;
   moveClip: (id: string) => void;
   run: Run;
   ask: Ask;
}) {
   const shareable = clip.shareables.at(-1);
   // In sidebar order, so a clip's tags always line up the same way.
   const tags = categories.filter((category) => clip.categories.includes(category.id));
   const tagNames = tags.map((category) => category.name).join(", ");
   const newTags = useNewTags(tags.map((category) => category.id));
   // Dragging out shares the same file Copy file would.
   const dragPath = defaultClipFile(clip)?.path;
   // The clip just left in the player rests on the frame it was left at, with that time in its length label.
   const rest = watchedAt ?? null;
   const scrub = useKeyframeScrub(clip, clip.duration > 0 && !clip.originalMissing && !job, { eager: rest !== null });
   const thumbnail = useThumbnailImage(clip.thumbnail);
   const card = useRef<HTMLElement>(null);
   const scrubbing = scrub.position !== null;
   const { setPosition } = scrub;
   useEffect(() => setPosition(rest), [rest, setPosition]);
   useEffect(() => {
      if (!scrubbing) return;
      // Pointer leave misses a card that scrolls out from under a still pointer, a drag taking over,
      // the window losing focus and a click through to the player. Each would leave the scrub and
      // its timecode open, so any of them ends it.
      const stop = () => setPosition(rest);
      const moved = (event: PointerEvent) => {
         if (!(event.target instanceof Node && card.current?.contains(event.target))) stop();
      };
      window.addEventListener("pointermove", moved, true);
      window.addEventListener("scroll", stop, true);
      window.addEventListener("dragstart", stop, true);
      window.addEventListener("blur", stop);
      document.addEventListener("visibilitychange", stop);
      return () => {
         window.removeEventListener("pointermove", moved, true);
         window.removeEventListener("scroll", stop, true);
         window.removeEventListener("dragstart", stop, true);
         window.removeEventListener("blur", stop);
         document.removeEventListener("visibilitychange", stop);
      };
   }, [scrubbing, setPosition, rest]);
   return (
      <article
         ref={card}
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
            scrub.setPosition(!row || inside ? Math.min(1, Math.max(0, (event.clientX - frame.left) / frame.width)) : rest);
         }}
         onPointerLeave={() => scrub.setPosition(rest)}
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
            onClick={() => {
               setPosition(rest);
               openClip(clip);
            }}
            aria-label={`Open ${clip.name}`}
         >
            <div className="clip-thumbnail" data-scrubbing={scrub.shown || undefined} data-same-frame={scrub.same || undefined}>
               {/* Under the thumbnail, which zooms and fades away to reveal it. */}
               <canvas ref={scrub.canvas} className="clip-scrub" aria-hidden="true" />
               {thumbnail.fallback && (
                  <div className="thumbnail-fallback" data-under={thumbnail.src ? true : undefined}>
                     <Clapperboard size={34} />
                  </div>
               )}
               {thumbnail.src && (
                  <img
                     src={thumbnail.src}
                     alt=""
                     decoding="async"
                     data-ready={thumbnail.ready || undefined}
                     onLoad={thumbnail.onLoad}
                     className={clip.height > clip.width ? "portrait-thumbnail" : undefined}
                  />
               )}
               {rest !== null && (
                  <span className="watched-overlay">
                     <Eye size={26} aria-hidden="true" />
                     <span>Just watched</span>
                  </span>
               )}
               {clip.duration > 0 && (
                  <Duration
                     duration={clip.duration}
                     position={
                        rest !== null && scrub.position === rest
                           ? rest * clip.duration
                           : scrub.frame === null
                             ? null
                             : (scrub.frame * clip.duration) / scrub.frames
                     }
                  />
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
                        <span>{job.state === "queued" ? "Queued" : job.kind === "trim" ? "Trimming" : "Creating shareable"}</span>
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
                        {tags.length > 0 && (
                           <span className="clip-tags" data-tooltip={tagNames} aria-label={`Tags: ${tagNames}`}>
                              {tags.map((category) => (
                                 <TagArrival key={category.id} className="clip-tag" fresh={newTags.has(category.id)}>
                                    <CategoryMark category={category} size={13} />
                                 </TagArrival>
                              ))}
                           </span>
                        )}
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
                  createTag={() => createTag(clip.id)}
                  clip={clip}
                  categories={categories}
                  busy={!!job}
                  canCreate={shareableTargetAllowed(clip.size, shareSizeMB)}
                  attaCutAvailable={attaCutAvailable}
                  ask={ask}
                  run={run}
                  create={() => void run(() => api.createShareable(clip.id))}
                  trim={() => trimClip(clip)}
                  move={() => moveClip(clip.id)}
               />
            </Menu>
         </div>
         {job && (
            <IconButton
               className="card-job-cancel"
               label={job.kind === "trim" ? "Cancel trim" : "Cancel shareable"}
               onClick={() => void run(() => api.cancelJob(job.id))}
            >
               <X size={12} />
            </IconButton>
         )}
      </article>
   );
});

// Names and details vary in length, so the stand-ins do too.
const titleWidths = [68, 52, 80, 60, 74, 56];
const detailWidths = [42, 50, 36, 46];

/** A card still loading, laid out like a clip card in either view so nothing shifts when it arrives. */
export function ClipPlaceholder({ index }: { index: number }) {
   return (
      <div
         className="clip-placeholder"
         aria-hidden="true"
         style={
            {
               "--placeholder-title": `${titleWidths[index % titleWidths.length]}%`,
               "--placeholder-detail": `${detailWidths[index % detailWidths.length]}%`,
            } as CSSProperties
         }
      >
         <span className="clip-placeholder-thumbnail skeleton" />
         <span className="clip-placeholder-info">
            <span className="clip-placeholder-title">
               <span className="skeleton" />
            </span>
            <span className="clip-placeholder-detail">
               <span className="skeleton" />
            </span>
         </span>
         <span className="clip-placeholder-facts">
            <span className="skeleton" />
            <span className="skeleton" />
         </span>
      </div>
   );
}
