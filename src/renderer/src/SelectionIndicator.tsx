import { useLayoutEffect, useRef } from "react";
import { createSliderMotion } from "./slider-motion";
import { createSelectionMotion } from "./selection-motion";

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
            element.style.transform = `translate(${x}px, ${y}px)`;
         },
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) }
      );
      const update = (resize: boolean) => {
         const selected = parent.querySelector<HTMLElement>(selector);
         if (!selected || !parent.getClientRects().length) {
            element.style.opacity = "0";
            shown = false;
            motion.to({ x: 0, y: 0 }, { x: 0, y: 0 }, true);
            return;
         }
         const bounds = parent.getBoundingClientRect(),
            rect = selected.getBoundingClientRect();
         const target = { x: rect.left - bounds.left - parent.clientLeft + parent.scrollLeft, y: rect.top - bounds.top - parent.clientTop + parent.scrollTop };
         element.style.width = `${rect.width}px`;
         element.style.height = `${rect.height}px`;
         const changed = selected !== selectedBefore;
         const layoutChanged =
            !changed && (target.x !== lastTarget.x || target.y !== lastTarget.y || rect.width !== lastSize.width || rect.height !== lastSize.height);
         // Layout changes never trail the selected control. Only selection changes bounce.
         if (resize || layoutChanged || changed || !shown || media.matches)
            motion.to(
               target,
               { x: Math.max(0, parent.scrollWidth - rect.width), y: Math.max(0, parent.scrollHeight - rect.height) },
               resize || layoutChanged || !shown || media.matches
            );
         element.style.opacity = "1";
         lastTarget = target;
         lastSize = { width: rect.width, height: rect.height };
         selectedBefore = selected;
         shown = true;
      };
      refresh.current = update;
      const resize = new ResizeObserver(() => update(true));
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
      mutations.observe(parent, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], childList: true, characterData: true });
      const layout = () => update(true);
      parent.addEventListener("scroll", layout, { passive: true });
      media.addEventListener("change", layout);
      document.fonts.addEventListener("loadingdone", layout);
      return () => {
         motion.dispose();
         refresh.current = null;
         resize.disconnect();
         mutations.disconnect();
         parent.removeEventListener("scroll", layout);
         media.removeEventListener("change", layout);
         document.fonts.removeEventListener("loadingdone", layout);
      };
   }, [selector]);
   useLayoutEffect(() => {
      refresh.current?.(false);
   }, [value]);
   return <span ref={marker} className="selection-indicator" aria-hidden="true" />;
}
