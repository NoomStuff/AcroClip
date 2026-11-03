import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, HTMLAttributes } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { groupFolders, visibleFolderRows } from "./library-index";
import { MotionList } from "./MotionList";
export function FolderTree({
   paths,
   counts,
   selected,
   onSelect,
   renderActions,
   requestMenu,
   dropProps,
   visible = true,
}: {
   paths: string[];
   visible?: boolean;
   counts?: ReadonlyMap<string, { count: number }>;
   selected: string | null;
   onSelect: (path: string) => void;
   dropProps?: ((path: string) => Pick<HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">) | undefined;
   renderActions?: (path: string) => ReactNode;
   requestMenu?: (path: string, element: HTMLElement, left: number, top: number) => void;
}) {
   const root = useRef<HTMLDivElement>(null);
   const [expanded, setExpanded] = useState(new Set<string>());
   const children = useMemo(() => groupFolders(paths), [paths]);
   const rows = useMemo(() => visibleFolderRows(children, expanded), [children, expanded]);
   const selectedExists = selected !== null && paths.includes(selected);
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
   const treeItems = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? []).filter((node) => !node.closest("[inert]"));
   const focus = (path: string) =>
      requestAnimationFrame(() =>
         treeItems()
            .find((node) => node.dataset["path"] === path)
            ?.focus()
      );
   const render = ({ id: path, level, hasChildren, open, position, siblings }: (typeof rows)[number]) => (
      <div
         className="folder-tree-row"
         data-empty={(counts && !counts.get(path)?.count) || undefined}
         style={{ marginLeft: (level - 1) * 16 }}
         {...dropProps?.(path)}
         onContextMenu={(event) => {
            if (!requestMenu) return;
            event.preventDefault();
            requestMenu(path, event.currentTarget.querySelector<HTMLButtonElement>('[role="treeitem"]')!, event.clientX, event.clientY);
         }}
         onKeyDown={(event) => {
            if (!requestMenu || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
            event.preventDefault();
            event.stopPropagation();
            const item = event.currentTarget.querySelector<HTMLButtonElement>('[role="treeitem"]')!;
            const bounds = item.getBoundingClientRect();
            requestMenu(path, item, bounds.left + 20, bounds.bottom);
         }}
      >
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
            data-list-control=""
            aria-level={level}
            aria-posinset={position}
            aria-setsize={siblings}
            aria-selected={selected === path}
            aria-expanded={hasChildren ? open : undefined}
            data-path={path}
            tabIndex={selected === path || (!selectedExists && path === rows[0]?.id) ? 0 : -1}
            className={`sidebar-item ${selected === path ? "selected" : ""}`}
            title={path}
            onClick={() => onSelect(path)}
         >
            {open ? <FolderOpen size={16} /> : <Folder size={16} />}
            <span>{path.split("/").at(-1)!}</span>
         </button>
         {renderActions?.(path)}
      </div>
   );
   return (
      <div
         ref={root}
         role="tree"
         aria-label="Collection folders"
         onKeyDown={(event) => {
            const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="treeitem"]');
            if (!item) return;
            const path = item.dataset["path"]!,
               nodes = treeItems(),
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
         <MotionList items={rows} visible={visible}>
            {render}
         </MotionList>
      </div>
   );
}
