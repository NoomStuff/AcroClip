import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { GripHorizontal } from "lucide-react";
import {
   defaultDock,
   dividerGroup,
   dividerKey,
   dividerLimits,
   dividerPosition,
   groupDividers,
   isDockLayout,
   layoutDock,
   planDrop,
   resizeDock,
   setPanelMinimums,
} from "./dock-layout";
import type { DockDivider, DockDividerGroup, DockDrop, DockNode, DockPanel, DockSide, Rect } from "./dock-layout";

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

export function useDock(container: RefObject<HTMLElement | null>, minimums: Partial<Record<DockPanel, { width: number; height: number }>> = {}) {
   const minimumKey = JSON.stringify(minimums);
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
   const placed = useMemo(() => {
      setPanelMinimums(JSON.parse(minimumKey) as typeof minimums);
      return bounds ? layoutDock(layout, bounds) : null;
   }, [layout, bounds, minimumKey]);
   // Lines keep the members they had when a drag started, so a line that splits or joins mid-drag keeps its pointer.
   const [frozen, setFrozen] = useState<Array<{ id: string; keys: string[] }> | null>(null);
   const groups = useMemo((): Array<DockDividerGroup & { id: string }> => {
      if (!placed) return [];
      if (!frozen) return groupDividers(placed.dividers).map((group) => ({ ...group, id: group.members.map(dividerKey).join("|") }));
      return frozen.flatMap(({ id, keys }) => {
         const members = placed.dividers.filter((divider) => keys.includes(dividerKey(divider)));
         return members.length ? [{ ...dividerGroup(members), id }] : [];
      });
   }, [placed, frozen]);
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
      pointerIn,
      groups,
      /** Starts a divider drag that moves `members` as their own line, or ends it with null. */
      hold(members: readonly DockDivider[] | null, id = "") {
         if (!members) return setFrozen(null);
         const moving = members.map(dividerKey);
         const rest = groups.map((group) => group.members.map(dividerKey).filter((key) => !moving.includes(key))).filter((keys) => keys.length);
         setFrozen([{ id, keys: moving }, ...rest.map((keys) => ({ id: keys.join("|"), keys }))]);
      },
      /** Moves linked dividers together by one delta that every one of them can take. */
      resize: (members: readonly DockDivider[], delta: number, persist: boolean) => {
         const limits = members.map((member) => dividerLimits(layout, member));
         const move = Math.max(Math.max(...limits.map(([low]) => low)), Math.min(Math.min(...limits.map(([, high]) => high)), delta));
         const next = members.reduce((node, member) => resizeDock(node, member, move), layout);
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

const snapDistance = 8;

/** One line of lined-up dividers. Dragging it snaps to other lines; Alt drags only the part under the pointer. */
function DockSeparator({ dock, group }: { dock: Dock; group: DockDividerGroup & { id: string } }) {
   const start = useRef<{ position: number; from: number; members: DockDivider[]; snaps: number[]; delta: number } | null>(null);
   const vertical = group.axis === "row";
   const position = (event: { clientX: number; clientY: number }) => (vertical ? event.clientX : event.clientY);
   const { rect } = group;
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-orientation={vertical ? "vertical" : "horizontal"}
         aria-label="Resize panels"
         className={`pane-divider dock-divider ${vertical ? "vertical" : "horizontal"}`}
         style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
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
            dock.resize(group.members, step, true);
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const pointer = dock.pointerIn(event.clientX, event.clientY);
            const across = vertical ? pointer.y : pointer.x;
            const under = group.members.find((member) =>
               vertical
                  ? across >= member.rect.y && across <= member.rect.y + member.rect.height
                  : across >= member.rect.x && across <= member.rect.x + member.rect.width
            );
            const members = event.altKey && under ? [under] : group.members;
            const snaps = (dock.placed?.dividers ?? [])
               .filter((other) => other.axis === group.axis && !members.includes(other))
               .map(dividerPosition)
               .filter((spot) => Math.abs(spot - group.position) >= 1);
            start.current = { position: position(event), from: group.position, members, snaps, delta: 0 };
            dock.hold(members, group.id);
         }}
         onPointerMove={(event) => {
            const origin = start.current;
            if (!origin) return;
            const raw = position(event) - origin.position;
            const snap = origin.snaps.find((spot) => Math.abs(origin.from + raw - spot) < snapDistance);
            origin.delta = snap === undefined || event.shiftKey ? raw : snap - origin.from;
            dock.resize(origin.members, origin.delta, false);
         }}
         onPointerUp={() => {
            const origin = start.current;
            if (origin) dock.resize(origin.members, origin.delta, true);
            start.current = null;
            dock.hold(null);
         }}
         onPointerCancel={() => {
            start.current = null;
            dock.hold(null);
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
         {dock.groups.map((group) => (
            <DockSeparator key={group.id} dock={dock} group={group} />
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
