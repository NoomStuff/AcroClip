import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type Axis = "x" | "y";
interface PaneOptions {
   key: string;
   initial: number;
   min: number;
   max: number;
   reserve: number;
   axis: Axis;
   fromEnd?: boolean;
}
function readSize(key: string, initial: number): number {
   try {
      const raw = localStorage.getItem(`acroclip.layout.${key}`);
      const value = raw === null ? initial : Number(raw);
      return Number.isFinite(value) ? value : initial;
   } catch {
      return initial;
   }
}
export function usePaneSize(container: RefObject<HTMLElement | null>, options: PaneOptions) {
   const { key, initial, min, max, reserve, axis, fromEnd = false } = options;
   const [desired, setDesired] = useState(() => readSize(key, initial));
   const [available, setAvailable] = useState(0);
   useEffect(() => {
      const node = container.current;
      if (!node) return;
      const observer = new ResizeObserver(([entry]) => {
         if (!entry) return;
         const length = axis === "x" ? entry.contentRect.width : entry.contentRect.height;
         if (length > 0) setAvailable(length);
      });
      observer.observe(node);
      return () => observer.disconnect();
   }, [container, axis]);
   const limit = available ? Math.max(min, Math.min(max, available - reserve)) : max;
   const clamp = (value: number) => Math.max(min, Math.min(limit, value));
   const size = clamp(desired);
   const update = (value: number, persist = false) => {
      const next = clamp(value);
      setDesired(next);
      if (persist) {
         try {
            localStorage.setItem(`acroclip.layout.${key}`, String(next));
         } catch {
            /* The layout still works without storage. */
         }
      }
   };
   return { size, min, max: limit, initial, axis, fromEnd, update };
}
export function PaneDivider({ label, pane, className = "" }: { label: string; pane: ReturnType<typeof usePaneSize>; className?: string }) {
   const drag = useRef<{ start: number; size: number; value: number } | null>(null);
   const horizontal = pane.axis === "y";
   const finish = () => {
      if (!drag.current) return;
      pane.update(drag.current.value, true);
      drag.current = null;
   };
   return (
      <div
         role="separator"
         tabIndex={0}
         aria-label={label}
         aria-orientation={horizontal ? "horizontal" : "vertical"}
         aria-valuemin={Math.round(pane.min)}
         aria-valuemax={Math.round(pane.max)}
         aria-valuenow={Math.round(pane.size)}
         aria-valuetext={`${Math.round(pane.size)} pixels`}
         className={`pane-divider ${horizontal ? "horizontal" : "vertical"} ${className}`}
         onDoubleClick={() => pane.update(pane.initial, true)}
         onKeyDown={(event) => {
            const delta = horizontal
               ? event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowUp"
                    ? -1
                    : 0
               : event.key === "ArrowRight"
                 ? 1
                 : event.key === "ArrowLeft"
                   ? -1
                   : 0;
            if (delta) {
               event.preventDefault();
               pane.update(pane.size + delta * (event.shiftKey ? 40 : 10) * (pane.fromEnd ? -1 : 1), true);
            } else if (["Home", "End", "Enter"].includes(event.key)) {
               event.preventDefault();
               pane.update(event.key === "Home" ? pane.min : event.key === "End" ? pane.max : pane.initial, true);
            }
         }}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { start: horizontal ? event.clientY : event.clientX, size: pane.size, value: pane.size };
         }}
         onPointerMove={(event) => {
            const current = drag.current;
            if (!current) return;
            const distance = (horizontal ? event.clientY : event.clientX) - current.start;
            current.value = Math.max(pane.min, Math.min(pane.max, current.size + distance * (pane.fromEnd ? -1 : 1)));
            pane.update(current.value);
         }}
         onPointerUp={finish}
         onLostPointerCapture={finish}
         onPointerCancel={() => {
            if (drag.current) pane.update(drag.current.size);
            drag.current = null;
         }}
      />
   );
}
