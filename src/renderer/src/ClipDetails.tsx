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
               </dl>
            ) : (
               <p className="muted">No shareables.</p>
            )}
         </div>
      </>
   );
}

export function ClipTags({ ids, categories }: { ids: readonly string[]; categories: readonly Category[] }) {
   if (!ids.length) return null;
   return (
      <div className="viewer-categories" aria-label="Tags">
         {categories
            .filter((category) => ids.includes(category.id))
            .map((category) => (
               <span key={category.id} className="viewer-category" style={categoryStyle(category.color)}>
                  <CategoryMark category={category} size={13} />
                  <span>{category.name}</span>
               </span>
            ))}
      </div>
   );
}
