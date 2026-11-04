import { useId, useState } from "react";
import type { Category, Clip, Shareable } from "../../shared/types";
import { CategoryMark } from "./CategoryEditor";
import { categoryStyle } from "./category-color";
import { formatSize, formatTime } from "./format";

export function ClipDetails({ clip, shareable, version }: { clip: Clip; shareable: Shareable | undefined; version: "original" | "shareable" }) {
   const facts =
      version === "original"
         ? [
              { label: "File size", value: clip.availability && !clip.size ? "Checking" : formatSize(clip.size) },
              { label: "Resolution", value: `${clip.width} × ${clip.height}` },
              { label: "Duration", value: clip.availability && !clip.duration ? "Checking" : formatTime(clip.duration) },
              { label: "Audio tracks", value: clip.availability && !clip.tracks.length ? "Checking" : clip.tracks.length || "None" },
           ]
         : shareable
           ? [
                { label: "File size", value: formatSize(shareable.size) },
                { label: "Size target", value: `${shareable.targetMB} MB` },
                { label: "Duration", value: formatTime(clip.duration) },
                { label: "Audio tracks", value: clip.tracks.length ? 1 : "None" },
             ]
           : [];
   return (
      <>
         <div className="version-info">
            {facts.length ? (
               <dl className="version-facts">
                  {facts.map(({ label, value }) => (
                     <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                     </div>
                  ))}
                  <div className="version-location">
                     <dt>Location</dt>
                     <dd>{version === "original" ? clip.path : shareable?.path}</dd>
                  </div>
               </dl>
            ) : (
               <p className="muted">No shareables.</p>
            )}
         </div>
      </>
   );
}

export function ClipTags({ ids, categories }: { ids: readonly string[]; categories: readonly Category[] }) {
   const [expanded, setExpanded] = useState(false);
   const listId = useId();
   const tags = categories.filter((category) => ids.includes(category.id));
   if (!tags.length) return null;
   return (
      <div className="viewer-categories" role="group" aria-label="Tags" data-expanded={expanded || undefined}>
         <div
            className="viewer-tag-list"
            id={listId}
            tabIndex={expanded ? 0 : undefined}
            role={expanded ? "region" : undefined}
            aria-label={expanded ? "All tags" : undefined}
         >
            {(expanded ? tags : tags.slice(0, 2)).map((category) => (
               <span key={category.id} className="viewer-category" style={categoryStyle(category.color)} title={category.name}>
                  <CategoryMark category={category} size={13} />
                  <span>{category.name}</span>
               </span>
            ))}
         </div>
         {tags.length > 2 && (
            <button className="viewer-tags-toggle" aria-controls={listId} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
               {expanded ? "Fewer tags" : `+${tags.length - 2} tags`}
            </button>
         )}
      </div>
   );
}
