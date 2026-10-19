import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
export function FolderTree({ paths, selected, onSelect }: { paths: string[]; selected: string | null; onSelect: (path: string) => void }) {
   const root = useRef<HTMLDivElement>(null);
   const [expanded, setExpanded] = useState(new Set<string>());
   const children = useMemo(() => {
      const result = new Map<string, string[]>();
      for (const path of paths) {
         const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
         result.set(parent, [...(result.get(parent) ?? []), path]);
      }
      return result;
   }, [paths]);
   useEffect(() => {
      if (selected === null) return;
      setExpanded((current) => {
         const next = new Set(current);
         const parts = selected.split("/");
         for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
         return next;
      });
   }, [selected]);
   const expand = (path: string, open: boolean) =>
      setExpanded((current) => {
         const next = new Set(current);
         if (open) next.add(path);
         else next.delete(path);
         return next;
      });
   const focus = (path: string) =>
      requestAnimationFrame(() =>
         Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])
            .find((node) => node.dataset["path"] === path)
            ?.focus()
      );
   const render = (parent: string, level: number) =>
      (children.get(parent) ?? []).map((path) => {
         const hasChildren = children.has(path),
            open = expanded.has(path),
            name = path.split("/").at(-1)!;
         return (
            <div key={path} role="none">
               <div className="folder-tree-row">
                  <button
                     type="button"
                     className="folder-expand"
                     tabIndex={-1}
                     aria-label={`${open ? "Collapse" : "Expand"} folder ${path}`}
                     disabled={!hasChildren}
                     onClick={() => expand(path, !open)}
                  >
                     <ChevronRight size={13} style={{ rotate: open ? "90deg" : undefined }} />
                  </button>
                  <button
                     type="button"
                     role="treeitem"
                     aria-level={level}
                     aria-selected={selected === path}
                     aria-expanded={hasChildren ? open : undefined}
                     data-path={path}
                     tabIndex={selected === path || (!paths.includes(selected ?? "") && path === paths[0]) ? 0 : -1}
                     className={`sidebar-item ${selected === path ? "selected" : ""}`}
                     title={path}
                     onClick={() => onSelect(path)}
                  >
                     {open ? <FolderOpen size={16} /> : <Folder size={16} />}
                     <span>{name}</span>
                  </button>
               </div>
               {hasChildren && open && (
                  <div role="group" className="folder-tree-children">
                     {render(path, level + 1)}
                  </div>
               )}
            </div>
         );
      });
   return (
      <div
         ref={root}
         role="tree"
         aria-label="Collection folders"
         onKeyDown={(event) => {
            const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]');
            if (!item) return;
            const path = item.dataset["path"]!,
               nodes = Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')),
               index = nodes.indexOf(item);
            if (["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) {
               event.preventDefault();
               event.stopPropagation();
               if (event.key === "ArrowDown") nodes[Math.min(nodes.length - 1, index + 1)]?.focus();
               if (event.key === "ArrowUp") nodes[Math.max(0, index - 1)]?.focus();
               if (event.key === "Home") nodes[0]?.focus();
               if (event.key === "End") nodes.at(-1)?.focus();
               if (event.key === "ArrowRight" && children.has(path)) {
                  if (!expanded.has(path)) expand(path, true);
                  else focus(children.get(path)![0]!);
               }
               if (event.key === "ArrowLeft") {
                  if (expanded.has(path)) expand(path, false);
                  else if (path.includes("/")) focus(path.slice(0, path.lastIndexOf("/")));
               }
            }
         }}
      >
         {render("", 1)}
      </div>
   );
}
