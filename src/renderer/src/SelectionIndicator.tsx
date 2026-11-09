import { useLayoutEffect, useRef } from "react";
import { createSliderMotion } from "./slider-motion";
import { createSelectionMotion } from "./selection-motion";
import { selectionBounce } from "./value-kick";

export function TabMarker() {
   const marker = useRef<HTMLSpanElement>(null);
   useLayoutEffect(() => {
      const node = marker.current;
      if (!node) return;
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const motion = createSliderMotion(
         0,
         (position) => {
            node.style.transform = `scaleY(${position / 100})`;
         },
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) }
      );
      node.style.transform = "scaleY(0)";
      motion.to(100, media.matches);
      const reduce = () => {
         if (media.matches) motion.finish();
      };
      media.addEventListener("change", reduce);
      return () => {
         motion.dispose();
         media.removeEventListener("change", reduce);
      };
   }, []);
   return <span ref={marker} className="rail-marker" aria-hidden="true" />;
}
export function SelectionIndicator({ value, selector = "button.selected" }: { value: string; selector?: string }) {
   const marker = useRef<HTMLSpanElement>(null);
   const refresh = useRef<((resize: boolean) => void) | null>(null);
   useLayoutEffect(() => {
      const element = marker.current,
         parent = element?.parentElement;
      if (!element || !parent) return;
      let selectedBefore: HTMLElement | null = null,
         shown = false;
      let lastTarget = { x: 0, y: 0 },
         lastSize = { width: 0, height: 0 };
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const motion = createSelectionMotion(
         ({ x, y }) => {
            // The translate property leaves scale free for the press and the pop.
            element.style.translate = `${x}px ${y}px`;
         },
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) }
      );
      const update = (resize: boolean) => {
         const selected = Array.from(parent.querySelectorAll<HTMLElement>(selector)).find((node) => !node.closest("[inert]"));
         if (!selected || !parent.getClientRects().length) {
            element.style.opacity = "0";
            shown = false;
            motion.to({ x: 0, y: 0 }, { x: 0, y: 0 }, true);
            return;
         }
         const bounds = parent.getBoundingClientRect(),
            visible = selected.getBoundingClientRect();
         // A pressed item is scaled down around its center while it springs back. Its center on screen
         // still follows list motion, so keep that and undo only the item's own scale for the size.
         const own = new DOMMatrixReadOnly(getComputedStyle(selected).transform);
         const rect = { width: visible.width / (Math.hypot(own.a, own.b) || 1), height: visible.height / (Math.hypot(own.c, own.d) || 1) };
         const target = {
            x: visible.left + visible.width / 2 - rect.width / 2 - bounds.left - parent.clientLeft + parent.scrollLeft,
            y: visible.top + visible.height / 2 - rect.height / 2 - bounds.top - parent.clientTop + parent.scrollTop,
         };
         element.style.width = `${rect.width}px`;
         element.style.height = `${rect.height}px`;
         const changed = selected !== selectedBefore;
         const layoutChanged =
            !changed && (target.x !== lastTarget.x || target.y !== lastTarget.y || rect.width !== lastSize.width || rect.height !== lastSize.height);
         // Layout changes never trail the selected control. Only selection changes bounce.
         const immediate = resize || layoutChanged || !shown || media.matches;
         if (immediate || changed)
            motion.to(target, { x: Math.max(0, parent.scrollWidth - rect.width), y: Math.max(0, parent.scrollHeight - rect.height) }, immediate);
         if (changed && !immediate && selectedBefore) selectionBounce(element, 0.035);
         element.style.opacity = "1";
         lastTarget = target;
         lastSize = { width: rect.width, height: rect.height };
         selectedBefore = selected;
         shown = true;
      };
      refresh.current = update;
      // Observing newly expanded rows also fires here. Snap only when the
      // selected control's geometry changes, so unrelated resizes do not
      // interrupt a selection animation.
      const resize = new ResizeObserver(() => update(false));
      const observe = () => {
         resize.observe(parent);
         for (const child of parent.querySelectorAll("button")) resize.observe(child);
      };
      observe();
      update(true);
      const mutations = new MutationObserver(() => {
         observe();
         update(false);
      });
      mutations.observe(parent, { subtree: true, attributes: true, attributeFilter: ["class", "hidden", "inert"], childList: true, characterData: true });
      const layout = () => update(true);
      let followFrame = 0;
      let followUntil = 0;
      const follow = (time: number) => {
         followFrame = 0;
         update(true);
         if (time < followUntil) followFrame = requestAnimationFrame(follow);
      };
      const listMotion = () => {
         followUntil = performance.now() + 340;
         if (!followFrame) followFrame = requestAnimationFrame(follow);
      };
      // Holding the selected item presses the indicator with it, so the label never shrinks inside a still background.
      const release = () => {
         delete element.dataset["pressed"];
         window.removeEventListener("pointerup", release);
         window.removeEventListener("pointercancel", release);
      };
      const press = (event: PointerEvent) => {
         if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("input")) return;
         const item = event.target.closest<HTMLElement>(selector);
         if (!item || !parent.contains(item) || item.matches(":disabled")) return;
         element.dataset["pressed"] = "";
         window.addEventListener("pointerup", release);
         window.addEventListener("pointercancel", release);
      };
      parent.addEventListener("pointerdown", press);
      parent.addEventListener("list-motion", listMotion);
      parent.addEventListener("scroll", layout, { passive: true });
      media.addEventListener("change", layout);
      document.fonts.addEventListener("loadingdone", layout);
      return () => {
         motion.dispose();
         refresh.current = null;
         resize.disconnect();
         mutations.disconnect();
         parent.removeEventListener("scroll", layout);
         parent.removeEventListener("pointerdown", press);
         release();
         parent.removeEventListener("list-motion", listMotion);
         cancelAnimationFrame(followFrame);
         media.removeEventListener("change", layout);
         document.fonts.removeEventListener("loadingdone", layout);
      };
   }, [selector]);
   useLayoutEffect(() => {
      refresh.current?.(false);
   }, [value]);
   return <span ref={marker} className="selection-indicator" aria-hidden="true" />;
}
