import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { GripHorizontal } from "lucide-react";
import {
   defaultDock,
   dividerLimits,
   dividerSides,
   dockFromSizes,
   dockPanel,
   flatten,
   neighbourPanel,
   dividerPosition,
   dividerSegments,
   dockCrossings,
   dockLines,
   isDockLayout,
   layoutDock,
   lineDividers,
   panelMinimum,
   planDrop,
   resizeDock,
   separateSegment,
} from "./dock-layout";
import type {
   DockAxis,
   DockCrossing,
   DockEdge,
   DockDivider,
   DockDrop,
   DockLine,
   DockNode,
   DockPanel,
   DockSegment,
   DockSide,
   PanelMinimums,
   Rect,
} from "./dock-layout";

const storageKey = "acroclip.layout.recording.dock";
const dragThreshold = 4;
const snapDistance = 8;
/** How close to a panel's top edge the pointer has to be before its grip shows. */
const gripReach = 40;

/** Sizes the side column and the audio row had before panels could dock anywhere. */
const paneKeys = ["acroclip.layout.recording.controls", "acroclip.layout.recording.lower"];

function readLayout(): DockNode {
   try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (isDockLayout(value)) return value;
      const [side, lower] = paneKeys.map((key) => Number(localStorage.getItem(key)));
      const layout = dockFromSizes(side! > 0 ? side! : 340, lower! > 0 ? lower! : 250);
      storeLayout(layout);
      for (const key of paneKeys) localStorage.removeItem(key);
      return layout;
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
export const dividerKey = (divider: Pick<DockDivider, "path" | "index">) => `${divider.path.join(".")}:${divider.index}`;
const sameDivider = (a: Pick<DockDivider, "path" | "index">, b: Pick<DockDivider, "path" | "index">) =>
   a.index === b.index && a.path.join(".") === b.path.join(".");

type ResizeTarget = { line: DockLine } | { arm: DockSegment } | { crossing: DockCrossing };
interface Move {
   axis: DockAxis;
   dividers: DockDivider[];
}

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
   const [resizing, setResizing] = useState<DockDivider[]>([]);
   const [settling, setSettling] = useState(false);
   const [announcement, setAnnouncement] = useState("");
   /** The divider a key press moved, so focus can follow it when its line is rebuilt. */
   const focusAfter = useRef<string | null>(null);
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
   const lines = useMemo(() => (placed ? dockLines(dividerSegments(placed.dividers)) : []), [placed]);
   const crossings = useMemo(() => dockCrossings(lines), [lines]);
   const commit = (next: DockNode, animate: boolean) => {
      setSettling(animate);
      setLayout(next);
      storeLayout(next);
   };
   const pointerIn = (clientX: number, clientY: number) => {
      const box = container.current?.getBoundingClientRect();
      return { x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) };
   };
   /** An arm is pulled out of its crossings first; whole lines and crossings move the dividers as they are. */
   const plan = (target: ResizeTarget, area: Rect): { root: DockNode; moves: Move[] } => {
      if ("arm" in target) {
         const { root, divider } = separateSegment(layout, area, target.arm, minimums);
         return { root, moves: [{ axis: divider.axis, dividers: [divider] }] };
      }
      const lines = "line" in target ? [target.line] : [target.crossing.upright, target.crossing.flat];
      return { root: layout, moves: lines.map((line) => ({ axis: line.axis, dividers: lineDividers(line) })) };
   };
   /** Every divider in a move takes the same delta, cut down to what all of them can take. */
   const applyMoves = (root: DockNode, moves: Move[], delta: (axis: DockAxis, index: number) => number) =>
      moves.reduce((node, { axis, dividers }, index) => {
         const limits = dividers.map((divider) => dividerLimits(root, divider, minimums));
         const low = Math.max(...limits.map(([value]) => value));
         const high = Math.min(...limits.map(([, value]) => value));
         const step = Math.max(low, Math.min(high, delta(axis, index)));
         return dividers.reduce((current, divider) => resizeDock(current, divider, step, minimums), node);
      }, root);
   return {
      placed,
      lines,
      crossings,
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
      pointerIn,
      announcement,
      /** How far a set of dividers can move together, and the panel names on each side of them. */
      describe(dividers: readonly DockDivider[]) {
         const limits = dividers.map((divider) => dividerLimits(layout, divider, minimums));
         const sides = dividers.map((divider) => dividerSides(layout, divider));
         const names = (index: 0 | 1) => [...new Set(sides.flatMap((side) => side[index]))].map((panel) => panelLabel[panel].toLowerCase()).join(", ");
         return {
            low: Math.max(...limits.map(([value]) => value)),
            high: Math.min(...limits.map(([, value]) => value)),
            before: names(0),
            after: names(1),
         };
      },
      focusAfter,
      /** Moves a panel from the keyboard: swaps it with its neighbour, or docks it along the whole edge. */
      shift(panel: DockPanel, edge: DockEdge, whole: boolean) {
         if (!placed || !bounds) return;
         const neighbour = whole ? null : neighbourPanel(placed.panels, panel, edge);
         if (!whole && !neighbour) return;
         const next = flatten(
            neighbour
               ? dockPanel(layout, panel, neighbour, "center", placed.panels[neighbour], minimums)
               : dockPanel(layout, panel, "root", edge, bounds, minimums)
         );
         commit(next, true);
         setAnnouncement(`${panelLabel[panel]}: ${dropLabel(neighbour ?? "root", neighbour ? "center" : edge).toLowerCase()}`);
      },
      /** Moves a line, arm or crossing by a fixed step, as the arrow keys do. */
      nudge(target: ResizeTarget, x: number, y: number) {
         if (!bounds) return;
         const { root, moves } = plan(target, bounds);
         focusAfter.current = dividerKey(moves[0]!.dividers[0]!);
         commit(
            applyMoves(root, moves, (axis) => (axis === "row" ? x : y)),
            false
         );
      },
      /**
       * Drags a whole line, one arm of it, or a crossing. Listeners sit on the window, because pulling
       * an arm out of a crossing replaces the element that was pressed.
       */
      startResize(target: ResizeTarget, clientX: number, clientY: number) {
         if (!bounds) return;
         stopResize.current();
         const { root, moves } = plan(target, bounds);
         const dividers = layoutDock(root, bounds, minimums).dividers;
         const snaps = moves.map(({ axis, dividers: moving }) => ({
            from: dividerPosition(moving[0]!),
            spots: dividers
               .filter((other) => other.axis === axis && !moving.some((item) => sameDivider(item, other)))
               .map(dividerPosition)
               .filter((spot) => Math.abs(spot - dividerPosition(moving[0]!)) >= 1),
         }));
         let next = root;
         setLayout(root);
         setResizing(moves.flatMap((item) => item.dividers));
         const move = (event: PointerEvent) => {
            next = applyMoves(root, moves, (axis, index) => {
               const raw = axis === "row" ? event.clientX - clientX : event.clientY - clientY;
               const { from, spots } = snaps[index]!;
               const snap = event.shiftKey ? undefined : spots.find((spot) => Math.abs(from + raw - spot) < snapDistance);
               return snap === undefined ? raw : snap - from;
            });
            setLayout(next);
         };
         const key = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
         };
         const end = (save: boolean) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("keydown", key, true);
            stopResize.current = () => undefined;
            setResizing([]);
            if (save) commit(next, false);
            else setLayout(layout);
         };
         const up = () => end(true);
         const cancel = () => end(false);
         window.addEventListener("pointermove", move);
         window.addEventListener("pointerup", up);
         window.addEventListener("pointercancel", cancel);
         window.addEventListener("keydown", key, true);
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
   const start = useRef<{ x: number; y: number; moved: boolean; cancelled: boolean } | null>(null);
   const cancel = useRef(dock.cancel);
   cancel.current = dock.cancel;
   useEffect(() => {
      const key = (event: KeyboardEvent) => {
         const origin = start.current;
         if (event.key !== "Escape" || !origin?.moved || origin.cancelled) return;
         event.preventDefault();
         event.stopPropagation();
         origin.cancelled = true;
         cancel.current();
      };
      window.addEventListener("keydown", key, true);
      return () => window.removeEventListener("keydown", key, true);
   }, []);
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
         tabIndex={0}
         className="dock-grip"
         aria-label={`Move ${label}`}
         aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
         data-tooltip={dock.drag ? undefined : `Drag to move ${label.toLowerCase()}. Double-click resets the layout.`}
         onDoubleClick={dock.reset}
         onKeyDown={(event) => {
            const edge = arrowEdges[event.key];
            if (!edge || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            dock.shift(panel, edge, event.shiftKey);
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = { x: event.clientX, y: event.clientY, moved: false, cancelled: false };
         }}
         onPointerMove={(event) => {
            const origin = start.current;
            if (!origin || origin.cancelled) return;
            if (!origin.moved && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < dragThreshold) return;
            origin.moved = true;
            dock.moveTo(panel, event.clientX, event.clientY);
         }}
         onPointerUp={() => {
            if (start.current?.moved && !start.current.cancelled) dock.drop();
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

const arrowEdges: Record<string, DockEdge> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };
const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** How far along a line the pointer may sit from an arm's middle and still pick out just that arm. */
const armReach = 24;
const armKey = (arm: DockSegment) => `${arm.divider.path.join(".")}:${arm.divider.index}:${arm.piece}`;
const spanOf = (axis: DockAxis, rect: Rect): [number, number] => (axis === "row" ? [rect.y, rect.y + rect.height] : [rect.x, rect.x + rect.width]);

/**
 * A straight line of dividers. It moves as one, so a grid shows one handle per line. Pointing at the
 * middle of one arm slides the handle over to it, and that arm then moves on its own.
 */
function DockLineHandle({ dock, line }: { dock: Dock; line: DockLine }) {
   const [picked, setPicked] = useState<number | null>(null);
   const upright = line.axis === "row";
   const [start, end] = spanOf(line.axis, line.rect);
   const middles = line.arms.map((arm) => {
      const [from, to] = spanOf(line.axis, arm.rect);
      return (from + to) / 2;
   });
   const pick = (clientX: number, clientY: number): number | null => {
      if (line.arms.length < 2) return null;
      const pointer = dock.pointerIn(clientX, clientY);
      const at = upright ? pointer.y : pointer.x;
      const centre = Math.abs(at - (start + end) / 2);
      let best: number | null = null;
      middles.forEach((middle, index) => {
         const distance = Math.abs(at - middle);
         if (distance < armReach && distance < centre && (best === null || distance < Math.abs(at - middles[best]!))) best = index;
      });
      return best;
   };
   const moving = line.arms.filter((arm) => dock.resizing.some((divider) => sameDivider(divider, arm.divider)));
   const dividers = lineDividers(line);
   const info = dock.describe(dividers);
   const size = dividers[0]!.sizes[dividers[0]!.index]!;
   const shown = moving.length ? moving : picked === null ? line.arms : [line.arms[picked]!];
   const from = Math.min(...shown.map((arm) => spanOf(line.axis, arm.rect)[0])) - start;
   const to = Math.max(...shown.map((arm) => spanOf(line.axis, arm.rect)[1])) - start;
   const along = (offset: number, length: number): CSSProperties => (upright ? { top: offset, height: length } : { left: offset, width: length });
   const at = (offset: number): CSSProperties => (upright ? { top: offset } : { left: offset });
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-orientation={upright ? "vertical" : "horizontal"}
         aria-label={upright ? `Left: ${info.before}. Right: ${info.after}` : `Above: ${info.before}. Below: ${info.after}`}
         aria-valuenow={Math.round(size)}
         aria-valuemin={Math.round(size + info.low)}
         aria-valuemax={Math.round(size + info.high)}
         aria-valuetext={`${Math.round(size)} pixels`}
         className={`pane-divider dock-divider ${upright ? "vertical" : "horizontal"}`}
         data-dividers={dividers.map(dividerKey).join(" ")}
         data-active={moving.length > 0 || undefined}
         style={{ position: "absolute", left: line.rect.x, top: line.rect.y, width: line.rect.width, height: line.rect.height }}
         onPointerMove={(event) => setPicked(pick(event.clientX, event.clientY))}
         onPointerLeave={() => setPicked(null)}
         onKeyDown={(event) => {
            const [x, y] = arrows[event.key] ?? [0, 0];
            if (!(upright ? x : y)) return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 10;
            dock.nudge({ line }, x * step, y * step);
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const arm = pick(event.clientX, event.clientY);
            dock.startResize(arm === null ? { line } : { arm: line.arms[arm]! }, event.clientX, event.clientY);
         }}
      >
         <span className="dock-band" style={along(from, to - from)} />
         {line.arms.length > 1 && middles.map((middle, index) => <span key={index} className="dock-mark" style={at(middle - start)} />)}
         <span className="dock-handle" style={at((from + to) / 2)} />
      </div>
   );
}

/** Where two lines meet. Dragging it moves both. */
function DockCrossingHandle({ dock, crossing }: { dock: Dock; crossing: DockCrossing }) {
   const { rect } = crossing;
   const upright = dock.describe(lineDividers(crossing.upright));
   const crossingNames = [...new Set([upright.before, upright.after].join(", ").split(", "))].join(", ");
   const moving = [crossing.upright, crossing.flat].every((line) =>
      line.arms.some((arm) => dock.resizing.some((divider) => sameDivider(divider, arm.divider)))
   );
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-label={`Resize ${crossingNames} in both directions`}
         className="dock-crossing"
         data-active={moving || undefined}
         style={{ left: rect.x + rect.width / 2, top: rect.y + rect.height / 2 }}
         onKeyDown={(event) => {
            const [x, y] = arrows[event.key] ?? [0, 0];
            if (!x && !y) return;
            event.preventDefault();
            const step = event.shiftKey ? 40 : 10;
            dock.nudge({ crossing }, x * step, y * step);
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            dock.startResize({ crossing }, event.clientX, event.clientY);
         }}
      >
         <span />
      </div>
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
   const status = useRef<HTMLSpanElement>(null);
   const { lines, focusAfter } = dock;
   useLayoutEffect(() => {
      const key = focusAfter.current;
      if (!key) return;
      focusAfter.current = null;
      if (document.activeElement && document.activeElement !== document.body) return;
      const layer = status.current?.parentElement;
      layer?.querySelector<HTMLElement>(`.dock-divider[data-dividers~="${key}"]`)?.focus({ preventScroll: true });
   }, [lines, focusAfter]);
   return (
      <>
         <span className="dock-status" role="status" ref={status}>
            {dock.announcement}
         </span>
         {dock.lines.map((line) => (
            <DockLineHandle key={`${line.axis}:${line.arms.map(armKey).join("|")}`} dock={dock} line={line} />
         ))}
         {dock.crossings.map((crossing) => (
            <DockCrossingHandle key={`${armKey(crossing.upright.arms[0]!)}+${armKey(crossing.flat.arms[0]!)}`} dock={dock} crossing={crossing} />
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
