import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { createGridMotion, paintGridCard, paintGridThumbnail } from "./grid-motion";

// Bound measurements and animations so filtering a large collection stays cheap.
export function useGridMotion<T extends HTMLElement>(
   root: RefObject<T | null>,
   signature: string,
   visible: boolean,
   navigationKey = "",
   layoutKey = "",
   flowResize = false
) {
   const motion = useRef<ReturnType<typeof createGridMotion<HTMLElement>> | null>(null);
   const thumbnailMotion = useRef<ReturnType<typeof createGridMotion<HTMLElement>> | null>(null);
   const capturedThumbnails = useRef(new Map<HTMLElement, { width: number; height: number }>());
   const known = useRef(new Set<string>());
   const measured = useRef(new Set<HTMLElement>());
   const appearances = useRef(new Map<HTMLElement, Animation>());
   const previousFlow = useRef(flowResize);
   const previousLayout = useRef(layoutKey);
   const previousNavigation = useRef(navigationKey);
   const releaseRows = useCallback(() => {
      if (!motion.current?.active && !thumbnailMotion.current?.active) root.current?.style.removeProperty("grid-template-rows");
   }, [root]);
   const captureLayout = useCallback(() => {
      const grid = root.current;
      if (!grid) return;
      const bounds = grid.getBoundingClientRect();
      const captures = Array.from(grid.children)
         .slice(0, 120)
         .map((child) => {
            const node = child as HTMLElement;
            const rect = node.getBoundingClientRect();
            const thumbnail = node.querySelector<HTMLElement>(".clip-thumbnail");
            const image = thumbnail?.getBoundingClientRect();
            return { node, rect, thumbnail, image };
         });
      capturedThumbnails.current.clear();
      for (const { node, rect, thumbnail, image } of captures) {
         motion.current?.to(node, { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height }, false, true);
         if (thumbnail && image) capturedThumbnails.current.set(thumbnail, { width: image.width, height: image.height });
      }
   }, [root]);
   const clear = useCallback(() => {
      motion.current?.clear();
      thumbnailMotion.current?.clear();
      capturedThumbnails.current.clear();
      root.current?.style.removeProperty("grid-template-rows");
      for (const animation of appearances.current.values()) animation.cancel();
      appearances.current.clear();
      known.current.clear();
      measured.current.clear();
   }, [root]);
   useLayoutEffect(() => {
      const grid = root.current;
      const layoutChanged = previousLayout.current !== layoutKey;
      const directFlow = !layoutChanged && (flowResize || previousFlow.current);
      previousFlow.current = flowResize;
      previousLayout.current = layoutKey;
      const navigated = previousNavigation.current !== navigationKey;
      previousNavigation.current = navigationKey;
      if (navigated) clear();
      if (!grid || !visible || matchMedia("(prefers-reduced-motion: reduce)").matches) {
         clear();
         return;
      }
      const controller = (motion.current ??= createGridMotion<HTMLElement>(
         (node, offset, current, target) => paintGridCard(node.style, offset, current, target),
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) },
         releaseRows
      ));
      const images = (thumbnailMotion.current ??= createGridMotion<HTMLElement>(
         (node, _offset, current, target) => paintGridThumbnail(node.style, current, target),
         { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) },
         releaseRows
      ));
      if (directFlow) {
         controller.clear();
         images.clear();
      }
      // Restore natural layout for measurement. Reapply the current visual sizes before paint.
      grid.style.removeProperty("grid-template-rows");
      for (const node of measured.current) {
         node.style.removeProperty("width");
         node.style.removeProperty("height");
         node.style.removeProperty("transform");
         const thumbnail = node.querySelector<HTMLElement>(".clip-thumbnail");
         if (thumbnail) paintGridThumbnail(thumbnail.style);
      }
      measured.current.clear();
      const rows = getComputedStyle(grid).gridTemplateRows;
      const bounds = grid.getBoundingClientRect();
      const next = new Set<string>();
      const active = new Set<HTMLElement>();
      const imageTargets: { node: HTMLElement; width: number; height: number; immediate: boolean }[] = [];
      const targets: { node: HTMLElement; left: number; top: number; width: number; height: number; enter: boolean; immediate: boolean }[] = [];
      // Read all layout positions before writing any compensating transforms.
      for (let i = 0; i < Math.min(grid.children.length, 120); i++) {
         const node = grid.children[i] as HTMLElement;
         const key = node.dataset["layoutKey"];
         if (!key) continue;
         active.add(node);
         measured.current.add(node);
         next.add(key);
         const rect = node.getBoundingClientRect();
         const thumbnail = node.querySelector<HTMLElement>(".clip-thumbnail");
         if (thumbnail) {
            const image = thumbnail.getBoundingClientRect();
            imageTargets.push({
               node: thumbnail,
               width: image.width,
               height: image.height,
               immediate: directFlow || rect.bottom < 0 || rect.top > innerHeight,
            });
         }
         targets.push({
            node,
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
            enter: !known.current.has(key) && (navigated || known.current.size > 0),
            immediate: directFlow || rect.bottom < 0 || rect.top > innerHeight,
         });
      }
      controller.retain(active);
      for (const [node, animation] of appearances.current) {
         if (grid.contains(node)) continue;
         animation.cancel();
         appearances.current.delete(node);
      }
      for (const { node, left, top, width, height, enter, immediate } of targets) {
         controller.to(node, { left, top, width, height }, enter, immediate);
         if (!enter || immediate) continue;
         const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "cubic-bezier(.22,.8,.3,1)" });
         appearances.current.set(node, animation);
         animation.onfinish = () => {
            if (appearances.current.get(node) === animation) appearances.current.delete(node);
         };
      }
      images.retain(new Set(imageTargets.map((target) => target.node)));
      const animateImages = layoutChanged || images.active;
      for (const { node, width, height, immediate } of imageTargets) {
         const captured = layoutChanged ? capturedThumbnails.current.get(node) : undefined;
         if (captured) images.to(node, { left: 0, top: 0, ...captured }, false, true);
         images.to(node, { left: 0, top: 0, width, height }, false, immediate || !animateImages);
      }
      capturedThumbnails.current.clear();
      if (layoutChanged) {
         for (const target of targets) {
            if (target.immediate) continue;
            for (const node of target.node.querySelectorAll<HTMLElement>(".clip-card-info,.clip-file-facts")) {
               const previous = appearances.current.get(node);
               previous?.cancel();
               const animation = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 40, fill: "backwards" });
               appearances.current.set(node, animation);
               animation.onfinish = () => {
                  if (appearances.current.get(node) === animation) appearances.current.delete(node);
               };
            }
         }
      }
      // Keep layout slots at their destination sizes while the cards resize inside them.
      if (controller.active || images.active) grid.style.gridTemplateRows = rows;
      known.current = next;
   }, [root, signature, visible, navigationKey, layoutKey, flowResize, clear, releaseRows]);
   useLayoutEffect(() => {
      const media = matchMedia("(prefers-reduced-motion: reduce)");
      const reduce = () => {
         if (media.matches) clear();
      };
      media.addEventListener("change", reduce);
      return () => {
         media.removeEventListener("change", reduce);
         clear();
      };
   }, [clear]);
   return captureLayout;
}
