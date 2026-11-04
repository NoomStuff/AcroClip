import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

interface Drag {
   id: string;
   pointer: number;
   node: HTMLElement;
   capture: HTMLElement;
   x: number;
   y: number;
   currentY: number;
   grab: number;
   active: boolean;
   order: string[];
   original: string;
}

export type ReorderItems = (id: string, beforeId: string | null) => Promise<unknown> | void;

export function useListReorder<T extends { id: string }>(items: readonly T[], identity: string, commit: ReorderItems | undefined) {
   const [preview, setPreview] = useState<string[] | null>(null);
   const [draggingId, setDraggingId] = useState<string | null>(null);
   const drag = useRef<Drag | null>(null);
   const frame = useRef(0);
   const suppressPointerClick = useRef(false);
   const generation = useRef(0);
   const latest = useRef({ items, commit });
   latest.current = { items, commit };
   const keyboardOrder = useRef<string[] | null>(null);
   const pendingKeyboard = useRef(0);
   const keyboardHistory = useRef(new Set<string>());
   const keyboardFocus = useRef<HTMLElement | null>(null);
   const enabled = commit !== undefined;
   const [announcement, setAnnouncement] = useState("");
   const paint = useRef<() => void>(() => undefined);
   const signature = items.map((item) => item.id).join("\0");
   const order = useMemo(() => {
      if (!preview) return items;
      const positions = new Map(preview.map((id, index) => [id, index]));
      return [...items].sort((a, b) => (positions.get(a.id) ?? items.length) - (positions.get(b.id) ?? items.length));
   }, [items, preview]);

   const stop = useRef<(save: boolean) => void>(() => undefined);
   stop.current = (save) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (current.capture.hasPointerCapture(current.pointer)) current.capture.releasePointerCapture(current.pointer);
      const transform = current.node.style.transform;
      current.node.style.removeProperty("transform");
      if (current.active) {
         suppressPointerClick.current = true;
         if (!matchMedia("(prefers-reduced-motion: reduce)").matches && save) {
            current.node.animate([{ transform }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(.22,.8,.3,1)" });
         }
         if (save && current.original !== current.order.join("\0")) {
            const index = current.order.indexOf(current.id);
            const operation = generation.current;
            const restore = () => {
               if (generation.current === operation && !drag.current) setPreview(null);
            };
            void Promise.resolve(latest.current.commit?.(current.id, current.order[index + 1] ?? null)).then(restore, restore);
         }
      }
      setDraggingId(null);
      // Keep the preview until the authoritative order arrives.
      if (!save || !current.active || current.original === current.order.join("\0")) setPreview(null);
   };
   paint.current = () => {
      const current = drag.current;
      if (!current?.active) return;
      if (!current.node.getClientRects().length) {
         stop.current(false);
         return;
      }
      const wrapper = current.node.parentElement;
      const list = wrapper?.parentElement;
      if (!wrapper || !list) {
         stop.current(false);
         return;
      }
      let scroll = list.parentElement;
      while (scroll && !/auto|scroll/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
      if (scroll) {
         const bounds = scroll.getBoundingClientRect();
         const speed = current.currentY < bounds.top + 32 ? -6 : current.currentY > bounds.bottom - 32 ? 6 : 0;
         if (speed) scroll.scrollTop += speed;
      }
      const bounds = list.getBoundingClientRect();
      const viewport = scroll?.getBoundingClientRect();
      const minimum = Math.max(bounds.top, viewport?.top ?? bounds.top);
      const maximum = Math.max(minimum, Math.min(bounds.bottom, viewport?.bottom ?? bounds.bottom) - current.node.offsetHeight);
      const top = Math.max(minimum, Math.min(maximum, current.currentY - current.grab));
      current.node.style.transform = `translateY(${top - wrapper.getBoundingClientRect().top}px)`;
      const center = top + current.node.offsetHeight / 2 - list.getBoundingClientRect().top;
      const rows = Array.from(list.children).filter(
         (child): child is HTMLElement => child instanceof HTMLElement && child.matches(".motion-list-item:not([data-exiting])")
      );
      let index = rows.findIndex((row) => center < row.offsetTop + row.offsetHeight);
      if (index < 0) index = rows.length - 1;
      const next = current.order.filter((id) => id !== current.id);
      next.splice(Math.max(0, index), 0, current.id);
      if (next.join("\0") !== current.order.join("\0")) {
         current.order = next;
         setPreview(next);
      }
      list.dispatchEvent(new Event("list-motion", { bubbles: true }));
   };
   useLayoutEffect(() => {
      if (drag.current?.active) {
         const current = drag.current;
         if (!current.capture.hasPointerCapture(current.pointer)) current.capture.setPointerCapture(current.pointer);
         paint.current();
      }
   }, [preview]);
   useLayoutEffect(() => {
      stop.current(false);
      const target = keyboardOrder.current;
      const current = latest.current.items;
      // Pending keyboard saves can report intermediate orders from this sequence.
      // An unrelated authoritative order must replace the preview immediately.
      if (
         pendingKeyboard.current > 0 &&
         keyboardHistory.current.has(signature) &&
         target &&
         target.length === current.length &&
         target.every((id) => current.some((item) => item.id === id))
      ) {
         if (target.join("\0") !== signature) return;
      }
      keyboardOrder.current = null;
      setPreview(null);
   }, [signature]);
   useLayoutEffect(() => {
      if (keyboardFocus.current?.isConnected && document.activeElement === document.body) keyboardFocus.current.focus({ preventScroll: true });
      if (!keyboardOrder.current) keyboardFocus.current = null;
   }, [preview, signature]);
   useLayoutEffect(() => {
      stop.current(false);
      keyboardOrder.current = null;
      keyboardFocus.current = null;
      setPreview(null);
   }, [identity, enabled]);
   useLayoutEffect(() => {
      if (!enabled) return;
      const tick = () => {
         frame.current = 0;
         if (!drag.current?.active) return;
         paint.current();
         frame.current = requestAnimationFrame(tick);
      };
      const move = (event: PointerEvent) => {
         const current = drag.current;
         if (!current || event.pointerId !== current.pointer) return;
         current.currentY = event.clientY;
         if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
         event.preventDefault();
         if (!current.active) {
            current.active = true;
            current.capture.setPointerCapture(current.pointer);
            setDraggingId(current.id);
            setPreview(current.order);
            frame.current = requestAnimationFrame(tick);
         }
      };
      const up = (event: PointerEvent) => {
         if (drag.current?.pointer === event.pointerId) {
            drag.current.currentY = event.clientY;
            if (drag.current.active) paint.current();
            stop.current(true);
         }
      };
      const cancel = () => stop.current(false);
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape" && drag.current?.active) {
            event.preventDefault();
            event.stopPropagation();
            cancel();
         }
      };
      document.addEventListener("pointermove", move, { passive: false });
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      document.addEventListener("keydown", key, true);
      window.addEventListener("blur", cancel);
      return () => {
         document.removeEventListener("pointermove", move);
         document.removeEventListener("pointerup", up);
         document.removeEventListener("pointercancel", cancel);
         document.removeEventListener("keydown", key, true);
         window.removeEventListener("blur", cancel);
         const current = drag.current;
         current?.node.style.removeProperty("transform");
         if (current?.capture.hasPointerCapture(current.pointer)) current.capture.releasePointerCapture(current.pointer);
         drag.current = null;
         cancelAnimationFrame(frame.current);
      };
   }, [enabled]);
   return {
      items: order,
      draggingId,
      announcement,
      pointerDown: (id: string, event: ReactPointerEvent<HTMLElement>) => {
         // A fresh press is an intentional click, even immediately after a drag.
         suppressPointerClick.current = false;
         if (!enabled || event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;
         const capture = event.currentTarget.querySelector<HTMLElement>("[data-list-control]");
         if (!capture || !(event.target instanceof Element) || event.target.closest("[data-list-control]") !== capture) return;
         keyboardOrder.current = null;
         keyboardFocus.current = null;
         generation.current++;
         // Capture before the browser can start a native text/image drag and
         // cancel the pointer stream. Keep normal clicks on the real button.
         event.preventDefault();
         capture.focus({ preventScroll: true });
         capture.setPointerCapture(event.pointerId);
         const original = latest.current.items.map((item) => item.id);
         drag.current = {
            id,
            pointer: event.pointerId,
            node: event.currentTarget,
            capture,
            x: event.clientX,
            y: event.clientY,
            currentY: event.clientY,
            grab: event.clientY - event.currentTarget.getBoundingClientRect().top,
            active: false,
            order: original,
            original: original.join("\0"),
         };
      },
      clickCapture: (event: ReactMouseEvent<HTMLElement>) => {
         if (event.detail > 0 && suppressPointerClick.current) {
            suppressPointerClick.current = false;
            event.preventDefault();
            event.stopPropagation();
         }
      },
      keyDown: (id: string, event: ReactKeyboardEvent<HTMLElement>) => {
         if (!enabled || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
         if (!(event.target instanceof Element) || event.target.closest("[data-list-control]") !== event.currentTarget.querySelector("[data-list-control]"))
            return;
         event.preventDefault();
         event.stopPropagation();
         const ids = keyboardOrder.current ?? latest.current.items.map((item) => item.id);
         if (!keyboardOrder.current) {
            keyboardHistory.current.clear();
            keyboardHistory.current.add(ids.join("\0"));
         }
         const index = ids.indexOf(id);
         const nextIndex = index + (event.key === "ArrowUp" ? -1 : 1);
         if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
         generation.current++;
         const next = ids.filter((item) => item !== id);
         next.splice(nextIndex, 0, id);
         keyboardOrder.current = next;
         keyboardHistory.current.add(next.join("\0"));
         keyboardFocus.current = event.target.closest<HTMLElement>("[data-list-control]");
         setPreview(next);
         const beforeId = next[nextIndex + 1] ?? null;
         const restore = () => {
            if (keyboardOrder.current !== next) return;
            keyboardOrder.current = null;
            setPreview(null);
         };
         pendingKeyboard.current++;
         void Promise.resolve(latest.current.commit?.(id, beforeId))
            .then((result) => {
               if (result === false) restore();
               else {
                  setAnnouncement(`Moved to position ${nextIndex + 1} of ${ids.length}`);
                  if (latest.current.items.map((item) => item.id).join("\0") === next.join("\0")) restore();
               }
            }, restore)
            .finally(() => {
               pendingKeyboard.current--;
            });
      },
   };
}
