import type { Ref } from "react";
import { ExternalLink, Folder } from "lucide-react";
import { Button } from "./ui";

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
         {onReveal ? (
            <button
               type="button"
               className="folder-picker-path"
               aria-label="Open collection folder"
               title={path}
               disabled={revealDisabled || !path}
               onClick={onReveal}
            >
               <span>{path || "No folder selected"}</span>
               <ExternalLink size={16} aria-hidden="true" />
            </button>
         ) : (
            <span title={path}>{path || "No folder selected"}</span>
         )}
         <Button data-choose-folder onClick={onChoose}>
            Choose folder
         </Button>
      </div>
   );
}
