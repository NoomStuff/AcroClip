import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { GripVertical, LayoutGrid, RotateCcw, Check } from "lucide-react";

export type RecordingPanel = "preview" | "sources" | "mixer" | "actions";
type Slot = "main" | "side" | "bottom" | "corner";
type Arrangement = Record<Slot, RecordingPanel>;

const slotArea: Record<Slot, CSSProperties> = {
   main: { gridColumn: 1, gridRow: 1 },
   side: { gridColumn: 3, gridRow: 1 },
   bottom: { gridColumn: 1, gridRow: 3 },
   corner: { gridColumn: 3, gridRow: 3 },
};
const panelName: Record<RecordingPanel, string> = { preview: "Preview", sources: "Sources", mixer: "Audio", actions: "Capture buttons" };
const defaultArrangement: Arrangement = { main: "preview", side: "sources", bottom: "mixer", corner: "actions" };
const storageKey = "acroclip.layout.recording.panels";
const slots = Object.keys(slotArea) as Slot[];

function readArrangement(): Arrangement {
   try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (!value || typeof value !== "object") return defaultArrangement;
      const stored = value as Record<string, unknown>;
      const panels = slots.map((slot) => stored[slot]);
      const valid = panels.every((panel) => typeof panel === "string" && panel in panelName) && new Set(panels).size === slots.length;
      return valid ? (stored as Arrangement) : defaultArrangement;
   } catch {
      return defaultArrangement;
   }
}

export function useRecordingPanels() {
   const [arrangement, setArrangement] = useState(readArrangement);
   const [editing, setEditing] = useState(false);
   const slotOf = (panel: RecordingPanel) => slots.find((slot) => arrangement[slot] === panel)!;
   const apply = (next: Arrangement) => {
      const commit = () => {
         flushSync(() => setArrangement(next));
         try {
            localStorage.setItem(storageKey, JSON.stringify(next));
         } catch {
            /* The layout still works without storage. */
         }
      };
      if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(commit);
      else commit();
   };
   const swap = (from: RecordingPanel, to: RecordingPanel) => {
      if (from === to) return;
      const a = slotOf(from),
         b = slotOf(to);
      apply({ ...arrangement, [a]: to, [b]: from });
   };
   return {
      editing,
      setEditing,
      style: (panel: RecordingPanel): CSSProperties => ({ ...slotArea[slotOf(panel)], viewTransitionName: `recording-${panel}` }),
      swap,
      reset: () => apply(defaultArrangement),
      custom: slots.some((slot) => arrangement[slot] !== defaultArrangement[slot]),
      arrangement,
   };
}

export function RecordingPanelEditor({ panels }: { panels: ReturnType<typeof useRecordingPanels> }) {
   const [dragging, setDragging] = useState<RecordingPanel | null>(null);
   const [target, setTarget] = useState<RecordingPanel | null>(null);
   const pointer = useRef<{ x: number; y: number } | null>(null);
   const [offset, setOffset] = useState({ x: 0, y: 0 });
   const { editing, setEditing } = panels;
   useEffect(() => {
      if (!editing) return;
      const close = (event: KeyboardEvent) => {
         if (event.key === "Escape") setEditing(false);
      };
      window.addEventListener("keydown", close);
      return () => window.removeEventListener("keydown", close);
   }, [editing, setEditing]);
   const panelAt = (x: number, y: number, moving: RecordingPanel): RecordingPanel | null => {
      for (const node of document.elementsFromPoint(x, y)) {
         const panel = (node as HTMLElement).dataset?.["layoutTarget"];
         if (panel && panel !== moving) return panel as RecordingPanel;
      }
      return null;
   };
   return (
      <>
         <div className="layout-toggle-slot">
            <button
               type="button"
               className="layout-toggle"
               data-active={panels.editing || undefined}
               aria-pressed={panels.editing}
               aria-label={panels.editing ? "Done arranging panels" : "Arrange panels"}
               data-tooltip={panels.editing ? "Done" : "Arrange panels"}
               onClick={() => panels.setEditing(!panels.editing)}
            >
               {panels.editing ? <Check size={14} /> : <LayoutGrid size={13} />}
            </button>
         </div>
         {panels.editing &&
            (Object.entries(panels.arrangement) as Array<[Slot, RecordingPanel]>).map(([slot, panel]) => (
               <div
                  key={panel}
                  className="layout-overlay"
                  style={{ ...slotArea[slot], ...(dragging === panel ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}) }}
                  data-layout-target={panel}
                  data-dragging={dragging === panel || undefined}
                  data-target={(dragging && dragging !== panel && target === panel) || undefined}
                  onPointerDown={(event) => {
                     if (event.button !== 0) return;
                     event.preventDefault();
                     event.currentTarget.setPointerCapture(event.pointerId);
                     pointer.current = { x: event.clientX, y: event.clientY };
                     setDragging(panel);
                     setOffset({ x: 0, y: 0 });
                  }}
                  onPointerMove={(event) => {
                     if (!pointer.current || dragging !== panel) return;
                     setOffset({ x: event.clientX - pointer.current.x, y: event.clientY - pointer.current.y });
                     setTarget(panelAt(event.clientX, event.clientY, panel));
                  }}
                  onPointerUp={(event) => {
                     const over = panelAt(event.clientX, event.clientY, panel);
                     pointer.current = null;
                     setDragging(null);
                     setTarget(null);
                     setOffset({ x: 0, y: 0 });
                     if (over && over !== panel) panels.swap(panel, over);
                  }}
                  onPointerCancel={() => {
                     pointer.current = null;
                     setDragging(null);
                     setTarget(null);
                     setOffset({ x: 0, y: 0 });
                  }}
               >
                  <span className="layout-overlay-label">
                     <GripVertical size={16} />
                     {panelName[panel]}
                  </span>
                  {slot === "side" && panels.custom && (
                     <button type="button" className="layout-reset" onPointerDown={(event) => event.stopPropagation()} onClick={() => panels.reset()}>
                        <RotateCcw size={13} />
                        Reset layout
                     </button>
                  )}
               </div>
            ))}
      </>
   );
}
