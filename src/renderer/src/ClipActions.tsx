import type { ReactNode } from "react";
import { AppWindow, Copy, ExternalLink, FolderInput, FolderOpen, Pencil, Plus, Scissors, Share2, Tag, Trash2 } from "lucide-react";
import type { Category, Clip } from "../../shared/types";
import type { Ask } from "./Dialog";
import type { Run } from "./desktop";
import { api, reportFeedback } from "./desktop";
import { CategoryMark } from "./CategoryEditor";
import { categoryStyle } from "./category-color";
import { MenuCheckboxItem, MenuItem, MenuSubmenu } from "./ui";
import { clipFileLabel, clipFiles, copiedMessage } from "./clip-files";
import type { ClipFile } from "./clip-files";
import { ApplicationIcon } from "./ApplicationIcon";
import { useOpenWith } from "./open-with";

export function ClipActions({
   clip,
   categories,
   busy,
   canCreate,
   ask,
   run,
   create,
   createTag,
   trim,
   move,
   remove,
   openPath,
   children,
}: {
   clip: Clip;
   categories: Category[];
   busy: boolean;
   canCreate: boolean;
   ask: Ask;
   run: Run;
   create: () => void;
   createTag: () => void;
   // Starts trimming in the player. Missing where the clip can't be trimmed right now.
   trim?: (() => void) | undefined;
   move?: (() => void) | undefined;
   // Deletes the clip, one shareable, or all of its shareables. Each asks first.
   remove?: ((shareableId?: string, scope?: "shareables") => void) | undefined;
   /** The file Open with opens, such as the version the player shows. The clip itself otherwise. */
   openPath?: string | undefined;
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
   // Making something from the clip, then getting the file out, then organizing it, then deleting.
   return (
      <>
         <MenuItem disabled={busy || !!clip.originalMissing || !canCreate} onClick={create}>
            <Share2 size={15} />
            {busy ? "Creating shareable…" : "Create shareable"}
         </MenuItem>
         {trim && (
            <MenuItem disabled={busy || !!clip.originalMissing} onClick={trim}>
               <Scissors size={15} />
               Trim clip
            </MenuItem>
         )}
         <div className="menu-separator" role="separator" />
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
         <FileChoice clip={clip} label="Show in folder" icon={<FolderOpen size={15} />} choose={(file) => void run(() => api.reveal(file.path))} />
         <OpenWithChoice path={openPath ?? openableFile(clip)?.path} run={run} />
         {children}
         <div className="menu-separator" role="separator" />
         <MenuItem disabled={busy || !!clip.originalMissing} onClick={() => void rename()}>
            <Pencil size={15} />
            Rename clip
         </MenuItem>
         <MenuSubmenu label="Tags" icon={<Tag size={15} />}>
            {categories.map((category) => (
               <MenuCheckboxItem
                  key={category.id}
                  style={categoryStyle(category.color)}
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
         {move && (
            <MenuItem disabled={busy || !!clip.originalMissing} onClick={move}>
               <FolderInput size={15} />
               Move to folder
            </MenuItem>
         )}
         <div className="menu-separator" role="separator" />
         <ShareableDeletion clip={clip} busy={busy} remove={removeFiles} />
         <MenuItem danger separated={false} disabled={busy} onClick={() => removeFiles()}>
            <Trash2 size={15} />
            Delete clip
         </MenuItem>
      </>
   );
}

/** The clip when it's there, since opening it elsewhere is mostly for editing. Its newest shareable otherwise. */
function openableFile(clip: Clip): ClipFile | undefined {
   const { original, shareables } = clipFiles(clip);
   return original.available ? original : shareables.at(-1);
}

/**
 * Open with, like a file manager's: the default app first, the others the system recommends under it,
 * and its own picker for anything else where it has one. Until the system has listed apps for this
 * file type, or where it can't, it's one item that opens the default app.
 */
function OpenWithChoice({ path, run }: { path: string | undefined; run: Run }) {
   const list = useOpenWith(path);
   if (!path || !list || (!list.apps.length && !list.canChoose))
      return (
         <MenuItem disabled={!path} onClick={() => path && void run(() => api.openFile(path))}>
            <ExternalLink size={15} />
            Open in default app
         </MenuItem>
      );
   const preferred = list.apps.find((app) => app.isDefault);
   const others = list.apps.filter((app) => app !== preferred);
   return (
      <MenuSubmenu label="Open with" icon={<ExternalLink size={15} />}>
         <MenuItem onClick={() => void run(() => api.openFile(path))}>
            {preferred ? <ApplicationIcon src={preferred.icon} size={16} /> : <ExternalLink size={15} />}
            {preferred?.name ?? "Default app"}
         </MenuItem>
         {others.length > 0 && <div className="menu-separator" role="separator" />}
         {others.map((app) => (
            <MenuItem key={app.id} onClick={() => void run(() => api.openWith(path, app.id))}>
               <ApplicationIcon src={app.icon} size={16} />
               {app.name}
            </MenuItem>
         ))}
         {list.canChoose && (
            <>
               <div className="menu-separator" role="separator" />
               <MenuItem onClick={() => void run(() => api.chooseOpenWith(path))}>
                  <AppWindow size={15} />
                  Choose another app…
               </MenuItem>
            </>
         )}
      </MenuSubmenu>
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
