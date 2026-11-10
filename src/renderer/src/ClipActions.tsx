import type { ReactNode } from "react";
import { Copy, FolderInput, FolderOpen, Pencil, Plus, Scissors, Share2, Tag, Trash2 } from "lucide-react";
import type { Category, Clip } from "../../shared/types";
import type { Ask } from "./Dialog";
import type { Run } from "./desktop";
import { api, reportFeedback } from "./desktop";
import { CategoryMark } from "./CategoryEditor";
import { MenuCheckboxItem, MenuItem, MenuSubmenu } from "./ui";
import { clipFileLabel, clipFiles, copiedMessage } from "./clip-files";
import type { ClipFile } from "./clip-files";

export function ClipActions({
   clip,
   categories,
   busy,
   canCreate,
   attaCutAvailable,
   ask,
   run,
   create,
   createTag,
   trim,
   move,
   remove,
   children,
}: {
   clip: Clip;
   categories: Category[];
   busy: boolean;
   canCreate: boolean;
   attaCutAvailable: boolean;
   ask: Ask;
   run: Run;
   create: () => void;
   createTag: () => void;
   // Starts trimming in the player. Missing where the clip can't be trimmed right now.
   trim?: (() => void) | undefined;
   move?: (() => void) | undefined;
   // Deletes the clip, one shareable, or all of its shareables. Each asks first.
   remove?: ((shareableId?: string, scope?: "shareables") => void) | undefined;
   children?: ReactNode;
}) {
   const removeFiles = (shareableId?: string, scope?: "shareables") =>
      remove ? remove(shareableId, scope) : void run(() => api.deleteClip(clip.id, shareableId, scope));
   const rename = async () => {
      const name = await ask({
         title: "Rename clip",
         initial: clip.name,
         confirm: "Rename",
         ...(clip.shareables.length ? { detail: "Renames the clip and all its shareables." } : {}),
      });
      if (typeof name === "string" && name) await run(() => api.renameClip(clip.id, name));
   };
   return (
      <>
         <MenuItem disabled={busy || !!clip.originalMissing || !canCreate} onClick={create}>
            <Share2 size={15} />
            {busy ? "Creating shareable…" : "Create shareable"}
         </MenuItem>
         <FileChoice
            clip={clip}
            label="Copy file"
            icon={<Copy size={15} />}
            choose={(file) =>
               void run(async () => {
                  await api.copyFile(file.path);
                  reportFeedback({ kind: "notice", message: copiedMessage(file), error: false });
               })
            }
         />
         <div className="menu-separator" role="separator" />
         <MenuItem disabled={busy || !!clip.originalMissing} onClick={() => void rename()}>
            <Pencil size={15} />
            Rename clip
         </MenuItem>
         {move && (
            <MenuItem disabled={busy || !!clip.originalMissing} onClick={move}>
               <FolderInput size={15} />
               Move to folder
            </MenuItem>
         )}
         <MenuSubmenu label="Tags" icon={<Tag size={15} />}>
            {categories.map((category) => (
               <MenuCheckboxItem
                  key={category.id}
                  checked={clip.categories.includes(category.id)}
                  onClick={() => void run(() => api.category("toggle", { clipId: clip.id, id: category.id }))}
               >
                  <CategoryMark category={category} size={15} />
                  {category.name}
               </MenuCheckboxItem>
            ))}
            {categories.length > 0 && <div className="menu-separator" role="separator" />}
            <MenuItem onClick={createTag}>
               <Plus size={15} />
               Create tag
            </MenuItem>
         </MenuSubmenu>
         <div className="menu-separator" role="separator" />
         <FileChoice clip={clip} label="Show in folder" icon={<FolderOpen size={15} />} choose={(file) => void run(() => api.reveal(file.path))} />
         {trim && (
            <MenuItem disabled={busy || !!clip.originalMissing} onClick={trim}>
               <Scissors size={15} />
               Trim clip
            </MenuItem>
         )}
         {attaCutAvailable && !clip.originalMissing && (
            <MenuItem onClick={() => void run(() => api.openInAttaCut(clip.id))}>
               <Scissors size={15} />
               Open in AttaCut
            </MenuItem>
         )}
         {children}
         <div className="menu-separator" role="separator" />
         <ShareableDeletion clip={clip} busy={busy} remove={removeFiles} />
         <MenuItem danger separated={false} disabled={busy} onClick={() => removeFiles()}>
            <Trash2 size={15} />
            Delete clip
         </MenuItem>
      </>
   );
}

/** One shareable deletes directly. Several ask which, with all of them last. */
function ShareableDeletion({ clip, busy, remove }: { clip: Clip; busy: boolean; remove: (shareableId?: string, scope?: "shareables") => void }) {
   const { shareables } = clipFiles(clip);
   const only = clip.shareables[0];
   if (!only) return null;
   if (clip.shareables.length === 1)
      return (
         <MenuItem danger separated={false} disabled={busy} onClick={() => remove(only.id)}>
            <Trash2 size={15} />
            Delete shareable
         </MenuItem>
      );
   return (
      <MenuSubmenu label="Delete shareable" icon={<Trash2 size={15} />} danger disabled={busy}>
         {clip.shareables.map((shareable, index) => (
            <MenuItem key={shareable.id} danger separated={false} onClick={() => remove(shareable.id)}>
               {clipFileLabel(shareables[index]!)}
            </MenuItem>
         ))}
         <div className="menu-separator" role="separator" />
         <MenuItem danger separated={false} onClick={() => remove(undefined, "shareables")}>
            Delete all shareables
         </MenuItem>
      </MenuSubmenu>
   );
}

/** One action for a clip with no shareables. With shareables, it asks which file. */
function FileChoice({ clip, label, icon, choose }: { clip: Clip; label: string; icon: ReactNode; choose: (file: ClipFile) => void }) {
   const { original, shareables } = clipFiles(clip);
   if (!shareables.length)
      return (
         <MenuItem disabled={!original.available} onClick={() => choose(original)}>
            {icon}
            {label}
         </MenuItem>
      );
   return (
      <MenuSubmenu label={label} icon={icon}>
         <MenuItem disabled={!original.available} onClick={() => choose(original)}>
            {clipFileLabel(original)}
         </MenuItem>
         <div className="menu-separator" role="separator" />
         {shareables.map((file) => (
            <MenuItem key={file.path} onClick={() => choose(file)}>
               {clipFileLabel(file)}
            </MenuItem>
         ))}
      </MenuSubmenu>
   );
}
