import type { Ref } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { folderName } from "./format";
import { Button, IconButton } from "./ui";

export function FolderPicker({
   path,
   onChoose,
   onReveal,
   revealDisabled = false,
   navigationHighlighted = false,
   disabled = false,
   className = "",
   ref,
}: {
   path: string;
   onChoose: () => void;
   onReveal?: () => void;
   revealDisabled?: boolean;
   navigationHighlighted?: boolean;
   /** Only choosing is held back. Opening the folder changes nothing. */
   disabled?: boolean;
   className?: string;
   ref?: Ref<HTMLDivElement>;
}) {
   return (
      <div
         className={`folder-picker ${className}`}
         ref={ref}
         role="group"
         aria-label="Collection folder"
         tabIndex={-1}
         data-navigation-highlight={navigationHighlighted || undefined}
      >
         <Folder size={21} aria-hidden="true" />
         <div className="folder-picker-copy">
            <span className="folder-picker-name">{path ? folderName(path) : "No folder selected"}</span>
            {path && (
               <span className="folder-picker-path" data-tooltip={path} data-tooltip-overflow="">
                  {path}
               </span>
            )}
         </div>
         {onReveal && (
            <IconButton label="Open collection folder" disabled={revealDisabled || !path} onClick={onReveal}>
               <FolderOpen size={17} />
            </IconButton>
         )}
         <Button data-choose-folder disabled={disabled} onClick={onChoose}>
            {path ? "Change folder" : "Choose folder"}
         </Button>
      </div>
   );
}
