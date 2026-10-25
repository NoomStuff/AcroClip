import type { Ref } from "react";
import { ExternalLink, Folder } from "lucide-react";
import { Button, IconButton } from "./ui";

export function FolderPicker({
   path,
   onChoose,
   onReveal,
   revealDisabled = false,
   navigationHighlighted = false,
   ref,
}: {
   path: string;
   onChoose: () => void;
   onReveal?: () => void;
   revealDisabled?: boolean;
   navigationHighlighted?: boolean;
   ref?: Ref<HTMLDivElement>;
}) {
   return (
      <div
         className="folder-picker"
         ref={ref}
         role="group"
         aria-label="Collection folder"
         tabIndex={-1}
         data-navigation-highlight={navigationHighlighted || undefined}
      >
         <Folder size={22} />
         <span title={path}>{path || "No folder selected"}</span>
         <Button onClick={onChoose}>Choose folder</Button>
         {onReveal && (
            <IconButton label="Open collection folder" disabled={revealDisabled} onClick={onReveal}>
               <ExternalLink size={17} />
            </IconButton>
         )}
      </div>
   );
}
