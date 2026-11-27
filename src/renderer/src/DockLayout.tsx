import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { GripHorizontal } from "lucide-react";
import { defaultDock, isDockLayout, layoutDock, planDrop, resizeDock } from "./dock-layout";
import type { DockDivider, DockDrop, DockNode, DockPanel, DockSide, Rect } from "./dock-layout";

const storageKey = "acroclip.layout.recording.dock";
const dragThreshold = 4;

function readLayout(): DockNode {
   try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return isDockLayout(value) ? value : defaultDock;
   } catch {
      return defaultDock;
   }
}
function storeLayout(layout: DockNode): void {
   try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
   } catch {
      /* The layout still works without storage. */
   }
}

interface Drag {
   panel: DockPanel;
   x: number;
   y: number;
   drop: DockDrop | null;
}

export function useDock(container: RefObject<HTMLElement | null>) {
   const [layout, setLayout] = useState(readLayout);
   const [bounds, setBounds] = useState<Rect | null>(null);
   const [drag, setDrag] = useState<Drag | null>(null);
   const [settling, setSettling] = useState(false);
   useEffect(() => {
      const node = container.current;
      if (!node) return;
      const observer = new ResizeObserver(([entry]) => {
         if (entry && entry.contentRect.width > 0) setBounds({ x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height });
      });
      observer.observe(node);
      return () => observer.disconnect();
   }, [container]);
   useEffect(() => {
      if (!settling) return;
      const timer = window.setTimeout(() => setSettling(false), 300);
      return () => window.clearTimeout(timer);
   }, [settling]);
   const placed = useMemo(() => (bounds ? layoutDock(layout, bounds) : null), [layout, bounds]);
   const commit = (next: DockNode, animate: boolean) => {
      setSettling(animate);
      setLayout(next);
      storeLayout(next);
   };
   const pointerIn = (clientX: number, clientY: number) => {
      const box = container.current?.getBoundingClientRect();
      return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
   };
   return {
      container,
      layout,
      placed,
      bounds,
      drag,
      settling,
      style(panel: DockPanel): CSSProperties {
         const rect = placed?.panels[panel];
         if (!rect) return { visibility: "hidden" };
         return { position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height };
      },
      moveTo(panel: DockPanel, clientX: number, clientY: number) {
         if (!placed || !bounds) return;
         const { x, y } = pointerIn(clientX, clientY);
         setDrag({ panel, x, y, drop: planDrop(layout, bounds, panel, x, y) });
      },
      drop() {
         if (drag?.drop) commit(drag.drop.next, true);
         setDrag(null);
      },
      cancel: () => setDrag(null),
      resize: (divider: DockDivider, delta: number, persist: boolean) => {
         const next = resizeDock(layout, divider, divider.sizes, delta);
         if (persist) commit(next, false);
         else setLayout(next);
      },
      reset: () => commit(defaultDock, true),
   };
}
type Dock = ReturnType<typeof useDock>;

/** The handle that moves a panel. It sits on the panel itself, so there is no separate arrange mode. */
export function DockGrip({ dock, panel, label }: { dock: Dock; panel: DockPanel; label: string }) {
   const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
   return (
      // Not a <button>: the capture actions style every button child as a capture button.
      <div
         role="button"
         tabIndex={-1}
         className="dock-grip"
         aria-label={`Move ${label}`}
         data-tooltip={dock.drag ? undefined : `Drag to move ${label.toLowerCase()}. Double-click resets the layout.`}
         onDoubleClick={dock.reset}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.clientX, y: event.clientY, moved: false };
         }}
         onPointerMove={(event) => {
            const origin = start.current;
            if (!origin) return;
            if (!origin.moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < dragThreshold) return;
            origin.moved = true;
            dock.moveTo(panel, event.clientX, event.clientY);
         }}
         onPointerUp={() => {
            if (start.current?.moved) dock.drop();
            start.current = null;
         }}
         onPointerCancel={() => {
            start.current = null;
            dock.cancel();
         }}
      >
         <GripHorizontal size={14} strokeWidth={2.4} />
      </div>
   );
}

function DockSeparator({ dock, divider }: { dock: Dock; divider: DockDivider }) {
   const start = useRef<{ position: number; divider: DockDivider; delta: number } | null>(null);
   const vertical = divider.axis === "row";
   const position = (event: { clientX: number; clientY: number }) => (vertical ? event.clientX : event.clientY);
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-orientation={vertical ? "vertical" : "horizontal"}
         aria-label="Resize panels"
         className={`pane-divider dock-divider ${vertical ? "vertical" : "horizontal"}`}
         style={{ position: "absolute", left: divider.rect.x, top: divider.rect.y, width: divider.rect.width, height: divider.rect.height }}
         onKeyDown={(event) => {
            const step =
               (event.shiftKey ? 40 : 10) *
               (vertical
                  ? event.key === "ArrowRight"
                     ? 1
                     : event.key === "ArrowLeft"
                       ? -1
                       : 0
                  : event.key === "ArrowDown"
                    ? 1
                    : event.key === "ArrowUp"
                      ? -1
                      : 0);
            if (!step) return;
            event.preventDefault();
            dock.resize(divider, step, true);
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { position: position(event), divider, delta: 0 };
         }}
         onPointerMove={(event) => {
            const origin = start.current;
            if (!origin) return;
            origin.delta = position(event) - origin.position;
            dock.resize(origin.divider, origin.delta, false);
         }}
         onPointerUp={() => {
            const origin = start.current;
            if (origin) dock.resize(origin.divider, origin.delta, true);
            start.current = null;
         }}
      />
   );
}

const panelLabel: Record<DockPanel, string> = { preview: "Preview", sources: "Sources", mixer: "Audio", actions: "Capture buttons" };

function dropLabel(target: DockPanel | "root", side: DockSide): string {
   if (target === "root") {
      if (side.includes("-")) return `${side[0]!.toUpperCase()}${side.slice(1)} corner`;
      return side === "left" || side === "right" ? `Full height on the ${side}` : `Full width at the ${side}`;
   }
   const name = panelLabel[target].toLowerCase();
   const labels: Partial<Record<DockSide, string>> = {
      center: `Swap with ${name}`,
      left: `Left of ${name}`,
      right: `Right of ${name}`,
      top: `Above ${name}`,
      bottom: `Below ${name}`,
   };
   return labels[side] ?? "";
}

/** Dividers between every pair of docked panels, and where a dragged panel would land. */
export function DockOverlay({ dock }: { dock: Dock }) {
   const drop = dock.drag?.drop;
   return (
      <>
         {dock.placed?.dividers.map((divider) => (
            <DockSeparator key={`${divider.path.join(".")}:${divider.index}`} dock={dock} divider={divider} />
         ))}
         {dock.drag && (
            <>
               {drop && (
                  <div
                     className="dock-drop"
                     data-swap={drop.side === "center" || undefined}
                     style={{ left: drop.preview.x, top: drop.preview.y, width: drop.preview.width, height: drop.preview.height }}
                  >
                     <span>{dropLabel(drop.target, drop.side)}</span>
                  </div>
               )}
               <div className="dock-chip" style={{ left: dock.drag.x, top: dock.drag.y }}>
                  {panelLabel[dock.drag.panel]}
               </div>
            </>
         )}
      </>
   );
}
