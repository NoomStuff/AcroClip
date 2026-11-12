import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useListReorder } from "./useListReorder";
import type { ReorderItems } from "./useListReorder";

interface Row<T> {
   key: string;
   item: T;
   exiting: boolean;
}

// Retain disappearing rows for their exit, and translate rows without scaling text.
export function MotionList<T extends { id: string }>({
   items: sourceItems,
   children,
   identity = "",
   onReorder,
   visible = true,
   followContentSize = false,
}: {
   items: readonly T[];
   children: (item: T) => ReactNode;
   identity?: string;
   onReorder?: ReorderItems | undefined;
   visible?: boolean;
   followContentSize?: boolean;
}) {
   const reorder = useListReorder(sourceItems, identity, onReorder);
   const { items, draggingId } = reorder;
   const root = useRef<HTMLDivElement>(null);
   const positions = useRef(new Map<string, number>());
   const animations = useRef(new Map<string, Animation>());
   const heightMotion = useRef<{ target: number; animation?: Animation } | null>(null);
   const previousIdentity = useRef(identity);
   const previousOrder = useRef(items.map((item) => item.id).join("\0"));
   const initialized = useRef(false);
   const layoutVisible = useRef(false);
   const [snapshot, setSnapshot] = useState({ items, rows: items.map((item): Row<T> => ({ key: item.id, item, exiting: false })) });
   if (snapshot.items !== items) {
      const present = new Set(items.map((item) => item.id));
      setSnapshot({
         items,
         rows: [
            ...items.map((item): Row<T> => ({ key: item.id, item, exiting: false })),
            ...snapshot.rows.filter((row) => !present.has(row.key)).map((row) => ({ ...row, exiting: true })),
         ],
      });
   }
   const resetLayout = useCallback(() => {
      for (const animation of animations.current.values()) animation.cancel();
      animations.current.clear();
      heightMotion.current?.animation?.cancel();
      heightMotion.current = null;
      positions.current.clear();
      initialized.current = false;
      layoutVisible.current = false;
      setSnapshot((current) => (current.rows.some((row) => row.exiting) ? { ...current, rows: current.rows.filter((row) => !row.exiting) } : current));
   }, []);
   useLayoutEffect(() => {
      const list = root.current;
      if (!list) return;
      const refreshVisibility = () => {
         if (!visible || !list.getClientRects().length || !list.offsetWidth) {
            resetLayout();
            return;
         }
         // Nested lists and folds change row positions without changing this
         // list's items. Keep their settled geometry as the next baseline.
         const baseline = new Map<string, number>();
         let height = 0;
         for (const row of list.querySelectorAll<HTMLElement>(":scope > .motion-list-item:not([data-exiting])")) {
            row.style.removeProperty("top");
            baseline.set(row.dataset["motionKey"]!, row.offsetTop);
            height += row.offsetHeight;
         }
         positions.current = baseline;
         if (!heightMotion.current?.animation) heightMotion.current = { target: height };
         initialized.current = true;
         layoutVisible.current = true;
      };
      const resize = new ResizeObserver(refreshVisibility);
      resize.observe(list);
      refreshVisibility();
      return () => resize.disconnect();
   }, [resetLayout, visible]);
   useLayoutEffect(() => {
      const list = root.current;
      if (!list) return;
      if (!visible || !list.getClientRects().length || !list.offsetWidth) {
         resetLayout();
         return;
      }
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const reset = previousIdentity.current !== identity;
      previousIdentity.current = identity;
      const order = items.map((item) => item.id).join("\0");
      const reordered = previousOrder.current !== order;
      previousOrder.current = order;
      const next = new Map<string, number>();
      let moving = false;
      let height = 0;
      for (const row of Array.from(list.children) as HTMLElement[]) {
         if (!row.classList.contains("motion-list-item")) continue;
         const key = row.dataset["motionKey"]!;
         const previous = positions.current.get(key);
         const exiting = row.hasAttribute("data-exiting");
         const wasExiting = row.dataset["exitStarted"] === "true";
         const running = animations.current.get(key);
         if (!exiting) row.style.removeProperty("top");
         if (!exiting) height += row.offsetHeight;
         if (!exiting && key === draggingId) {
            running?.cancel();
            animations.current.delete(key);
            next.set(key, row.offsetTop);
            continue;
         }
         if (!exiting && !wasExiting && !reset && previous === row.offsetTop && running && !(followContentSize && !reordered)) {
            next.set(key, previous);
            continue;
         }
         if (exiting && row.dataset["exitStarted"] && running && !reduce && !reset) {
            next.set(key, previous ?? 0);
            continue;
         }
         const painted = running ? getComputedStyle(row) : null;
         const transform = new DOMMatrixReadOnly(painted?.transform);
         const offset = transform.m42;
         const opacity = Number(painted?.opacity ?? 1);
         running?.cancel();
         animations.current.delete(key);
         if (exiting) {
            next.set(key, previous ?? 0);
            row.dataset["exitStarted"] = "true";
            row.style.top = `${previous ?? 0}px`;
            const remove = () => setSnapshot((current) => ({ ...current, rows: current.rows.filter((entry) => entry.key !== key || !entry.exiting) }));
            if (reduce || reset) {
               remove();
               continue;
            }
            const animation = row.animate(
               [
                  { opacity, transform: `translate(${transform.m41}px, ${offset}px)` },
                  { opacity: 0, transform: `translate(${transform.m41}px, ${offset}px) scale(.96)` },
               ],
               { duration: 180, easing: "ease-out", fill: "forwards" }
            );
            animations.current.set(key, animation);
            animation.onfinish = () => {
               animations.current.delete(key);
               remove();
            };
            continue;
         }
         delete row.dataset["exitStarted"];
         const top = row.offsetTop;
         next.set(key, top);
         // Nested sections follow their children's changing height directly.
         // A second FLIP here would chase that resize with another animation.
         if (reduce || reset || !initialized.current || !layoutVisible.current || (followContentSize && !reordered)) continue;
         const start = previous;
         const delta = start === undefined ? 0 : start - top + offset;
         if (start !== undefined && !wasExiting && Math.abs(delta) < 0.5) continue;
         const animation = row.animate(
            start === undefined
               ? [
                    { opacity: 0, transform: "scale(.96)" },
                    { opacity: 1, transform: "scale(1)" },
                 ]
               : [
                    { opacity, transform: `translate(${wasExiting ? transform.m41 : 0}px, ${delta}px) scale(${wasExiting ? transform.a : 1})` },
                    { opacity: 1, transform: "translateY(0)" },
                 ],
            { duration: start === undefined ? 220 : 300, easing: "cubic-bezier(.22,.8,.3,1)" }
         );
         animations.current.set(key, animation);
         animation.onfinish = () => {
            animations.current.delete(key);
         };
         moving = true;
      }
      positions.current = next;
      const previousHeight = heightMotion.current;
      if (followContentSize) {
         previousHeight?.animation?.cancel();
         heightMotion.current = { target: height };
      } else if (previousHeight?.target !== height) {
         const start = previousHeight?.animation ? list.getBoundingClientRect().height : previousHeight?.target;
         previousHeight?.animation?.cancel();
         const motion: { target: number; animation?: Animation } = { target: height };
         heightMotion.current = motion;
         if (!reduce && !reset && layoutVisible.current && start !== undefined && start !== height) {
            const animation = list.animate([{ height: `${start}px` }, { height: `${height}px` }], { duration: 300, easing: "cubic-bezier(.22,.8,.3,1)" });
            motion.animation = animation;
            animation.onfinish = () => {
               delete motion.animation;
            };
            moving = true;
         }
      }
      initialized.current = true;
      layoutVisible.current = true;
      if (moving) list.dispatchEvent(new Event("list-motion", { bubbles: true }));
   }, [snapshot.rows, identity, draggingId, resetLayout, visible, followContentSize, items]);
   useLayoutEffect(() => {
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const activeAnimations = animations.current;
      const finishHeight = () => heightMotion.current?.animation?.finish();
      const finish = () => {
         for (const animation of activeAnimations.values()) animation.finish();
         finishHeight();
      };
      const reduce = () => {
         if (media.matches) finish();
      };
      media.addEventListener("change", reduce);
      return () => {
         media.removeEventListener("change", reduce);
         for (const animation of activeAnimations.values()) animation.cancel();
         activeAnimations.clear();
         heightMotion.current?.animation?.cancel();
      };
   }, []);
   return (
      <div className="motion-list" ref={root}>
         {snapshot.rows.map((row) => (
            <div
               className="motion-list-item"
               key={row.key}
               data-motion-key={row.key}
               data-dragging={row.key === draggingId ? "" : undefined}
               data-exiting={row.exiting ? "" : undefined}
               inert={row.exiting}
               aria-hidden={row.exiting || undefined}
            >
               <div
                  className="motion-list-content"
                  onPointerDown={onReorder ? (event) => reorder.pointerDown(row.key, event) : undefined}
                  onClickCapture={onReorder ? reorder.clickCapture : undefined}
                  onKeyDown={onReorder ? (event) => reorder.keyDown(row.key, event) : undefined}
                  onDragStart={onReorder ? (event) => event.preventDefault() : undefined}
                  aria-keyshortcuts={onReorder ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
               >
                  {children(row.item)}
               </div>
            </div>
         ))}
         {onReorder && (
            <span className="motion-list-status" role="status">
               {reorder.announcement}
            </span>
         )}
      </div>
   );
}
