import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { GripHorizontal } from "lucide-react";
import { defaultDock, dividerPosition, dividerSegments, isDockLayout, layoutDock, panelMinimum, planDrop, resizeDock, separateSegment } from "./dock-layout";
import type { DockDivider, DockDrop, DockNode, DockPanel, DockSegment, DockSide, PanelMinimums, Rect } from "./dock-layout";

const storageKey = "acroclip.layout.recording.dock";
const dragThreshold = 4;
const snapDistance = 8;
/** How close to a panel's top edge the pointer has to be before its grip shows. */
const gripReach = 40;

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
const sameDivider = (a: Pick<DockDivider, "path" | "index">, b: Pick<DockDivider, "path" | "index">) =>
   a.index === b.index && a.path.join(".") === b.path.join(".");

interface Drag {
   panel: DockPanel;
   x: number;
   y: number;
   drop: DockDrop | null;
}

export function useDock(container: RefObject<HTMLElement | null>, minimums: PanelMinimums = panelMinimum) {
   const [layout, setLayout] = useState(readLayout);
   const [bounds, setBounds] = useState<Rect | null>(null);
   const [drag, setDrag] = useState<Drag | null>(null);
   const [resizing, setResizing] = useState<DockDivider | null>(null);
   const [settling, setSettling] = useState(false);
   const stopResize = useRef<() => void>(() => undefined);
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
   useEffect(() => () => stopResize.current(), []);
   const placed = useMemo(() => (bounds ? layoutDock(layout, bounds, minimums) : null), [layout, bounds, minimums]);
   const segments = useMemo(() => (placed ? dividerSegments(placed.dividers) : []), [placed]);
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
      placed,
      segments,
      drag,
      resizing,
      settling,
      style(panel: DockPanel): CSSProperties {
         const rect = placed?.panels[panel];
         if (!rect) return { visibility: "hidden" };
         return { position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height };
      },
      moveTo(panel: DockPanel, clientX: number, clientY: number) {
         if (!bounds) return;
         const { x, y } = pointerIn(clientX, clientY);
         setDrag({ panel, x, y, drop: planDrop(layout, bounds, panel, x, y, minimums) });
      },
      drop() {
         if (drag?.drop) commit(drag.drop.next, true);
         setDrag(null);
      },
      cancel: () => setDrag(null),
      /** Moves a divider by a fixed step, as the arrow keys do. */
      nudge(segment: DockSegment, step: number) {
         if (!bounds) return;
         const separate = separateSegment(layout, bounds, segment, minimums);
         commit(resizeDock(separate.root, separate.divider, step, minimums), false);
      },
      /**
       * Drags one arm of a divider. Listeners sit on the window, because splitting a crossing apart
       * replaces the element that was pressed.
       */
      startResize(segment: DockSegment, clientX: number, clientY: number) {
         if (!bounds) return;
         stopResize.current();
         const { root, divider } = separateSegment(layout, bounds, segment, minimums);
         const along = (x: number, y: number) => (divider.axis === "row" ? x : y);
         const origin = along(clientX, clientY);
         const from = dividerPosition(divider);
         const snaps = layoutDock(root, bounds, minimums)
            .dividers.filter((other) => other.axis === divider.axis && !sameDivider(other, divider))
            .map(dividerPosition)
            .filter((spot) => Math.abs(spot - from) >= 1);
         let next = root;
         setLayout(root);
         setResizing(divider);
         const move = (event: PointerEvent) => {
            const raw = along(event.clientX, event.clientY) - origin;
            const snap = event.shiftKey ? undefined : snaps.find((spot) => Math.abs(from + raw - spot) < snapDistance);
            next = resizeDock(root, divider, snap === undefined ? raw : snap - from, minimums);
            setLayout(next);
         };
         const end = (save: boolean) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            stopResize.current = () => undefined;
            setResizing(null);
            if (save) commit(next, false);
            else setLayout(layout);
         };
         const up = () => end(true);
         const cancel = () => end(false);
         window.addEventListener("pointermove", move);
         window.addEventListener("pointerup", up);
         window.addEventListener("pointercancel", cancel);
         stopResize.current = cancel;
      },
      reset: () => commit(defaultDock, true),
   };
}
type Dock = ReturnType<typeof useDock>;

/**
 * The handle that moves a panel. It sits on the panel itself, so there is no separate arrange mode,
 * and only shows while the pointer is near the panel's top edge.
 */
export function DockGrip({ dock, panel, label }: { dock: Dock; panel: DockPanel; label: string }) {
   const grip = useRef<HTMLDivElement>(null);
   const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
   useEffect(() => {
      const host = grip.current?.parentElement;
      if (!host) return;
      const move = (event: PointerEvent) => {
         const near = event.clientY - host.getBoundingClientRect().top < gripReach;
         if (near) host.dataset["dockNear"] = "";
         else delete host.dataset["dockNear"];
      };
      const leave = () => delete host.dataset["dockNear"];
      host.addEventListener("pointermove", move);
      host.addEventListener("pointerleave", leave);
      return () => {
         host.removeEventListener("pointermove", move);
         host.removeEventListener("pointerleave", leave);
      };
   }, []);
   return (
      // Not a <button>: the capture actions style every button child as a capture button.
      <div
         ref={grip}
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

const arrowSteps: Record<string, [number, "row" | "column"]> = {
   ArrowLeft: [-1, "row"],
   ArrowRight: [1, "row"],
   ArrowUp: [-1, "column"],
   ArrowDown: [1, "column"],
};

/** One arm of a divider. Arms that meet at a crossing move apart; lines that would break the layout join. */
function DockSeparator({ dock, segment }: { dock: Dock; segment: DockSegment }) {
   const vertical = segment.divider.axis === "row";
   const { rect } = segment;
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-orientation={vertical ? "vertical" : "horizontal"}
         aria-label="Resize panels"
         className={`pane-divider dock-divider ${vertical ? "vertical" : "horizontal"}`}
         data-active={(dock.resizing && sameDivider(dock.resizing, segment.divider)) || undefined}
         style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
         onKeyDown={(event) => {
            const [direction, axis] = arrowSteps[event.key] ?? [0, segment.divider.axis];
            if (!direction || axis !== segment.divider.axis) return;
            event.preventDefault();
            dock.nudge(segment, direction * (event.shiftKey ? 40 : 10));
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            dock.startResize(segment, event.clientX, event.clientY);
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
         {dock.segments.map((segment) => (
            <DockSeparator key={`${segment.divider.path.join(".")}:${segment.divider.index}:${segment.piece}`} dock={dock} segment={segment} />
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
