import { useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { Folder } from "lucide-react";

export function FolderCard({
   path,
   count,
   actions,
   dropProps,
   onOpen,
   requestMenu,
}: {
   path: string;
   count: number;
   actions: ReactNode;
   dropProps: Pick<HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;
   onOpen: (path: string) => void;
   requestMenu: (path: string, element: HTMLElement, left: number, top: number) => void;
}) {
   const button = useRef<HTMLButtonElement>(null);
   const name = path.split("/").at(-1)!;
   return (
      <article
         className="clip-card folder-card"
         data-empty={!count || undefined}
         data-layout-key={`folder:${path}`}
         {...dropProps}
         onContextMenu={(event) => {
            event.preventDefault();
            requestMenu(path, button.current ?? event.currentTarget, event.clientX, event.clientY);
         }}
         onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
            event.preventDefault();
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            requestMenu(path, button.current ?? event.currentTarget, bounds.left + 20, bounds.top + 30);
         }}
      >
         <button ref={button} className="clip-open" aria-label={`Open folder ${path}`} onClick={() => onOpen(path)}>
            <div className="clip-thumbnail">
               <Folder size={58} />
            </div>
            <div className="clip-card-info">
               <h3 data-tooltip={name} data-tooltip-overflow="">
                  {name}
               </h3>
               <p>
                  {count} {count === 1 ? "clip" : "clips"}
               </p>
            </div>
         </button>
         <div className="card-menu">{actions}</div>
      </article>
   );
}
