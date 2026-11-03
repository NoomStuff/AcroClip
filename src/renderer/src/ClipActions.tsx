import type { ReactNode } from "react";
import { FolderInput, FolderOpen, Pencil, Plus, Scissors, Share2, Tag, Trash2 } from "lucide-react";
import type { Category, Clip, Shareable } from "../../shared/types";
import type { Ask } from "./Dialog";
import type { Run } from "./desktop";
import { api } from "./desktop";
import { CategoryMark } from "./CategoryEditor";
import { MenuCheckboxItem, MenuItem, MenuSubmenu } from "./ui";

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
   move,
   remove,
   shareable = clip.shareables.at(-1),
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
   move?: (() => void) | undefined;
   remove?: (() => void) | undefined;
   shareable?: Shareable | undefined;
   children?: ReactNode;
}) {
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
         {children}
         <MenuItem danger disabled={busy} onClick={remove ?? (() => void run(() => api.deleteClip(clip.id)))}>
            <Trash2 size={15} />
            Delete clip
         </MenuItem>
      </>
   );
}
