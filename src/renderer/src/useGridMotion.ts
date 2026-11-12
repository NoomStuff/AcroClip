import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { createGridMotion, paintGridCard, paintGridThumbnail } from "./grid-motion";

const offscreen = (rect: DOMRect) => rect.bottom < 0 || rect.top > innerHeight;

const mountedCards = (grid: HTMLElement) => {
   const nodes: { node: HTMLElement; key: string }[] = [];
   // Bound measurements and animations so a tall window stays cheap.
   for (let index = 0; index < Math.min(grid.children.length, 120); index++) {
      const node = grid.children[index] as HTMLElement;
      const key = node.dataset["layoutKey"];
      if (key) nodes.push({ node, key });
   }
   return nodes;
};

/**
 * Glides the library's cards to their new places when the view changes. The grid only mounts
 * the rows near the viewport, and calls `settle` once those are laid out: a changed `signature`
 * animates from the previous layout, and anything else only notes the cards that scrolled in.
 * `viewKeys` names every item in the view, mounted or not, so scrolling a card into the window
 * doesn't count as that card joining the view.
 */
export function useGridMotion<T extends HTMLElement>(
   root: RefObject<T | null>,
   signature: unknown,
   viewKeys: ReadonlySet<string>,
   visible: boolean,
   navigationKey = "",
   layoutKey = "",
   flowResize = false
) {
   const motion = useRef<ReturnType<typeof createGridMotion<HTMLElement>> | null>(null);
   const thumbnailMotion = useRef<ReturnType<typeof createGridMotion<HTMLElement>> | null>(null);
   const capturedThumbnails = useRef(new Map<HTMLElement, { width: number; height: number }>());
   const known = useRef<ReadonlySet<string>>(new Set());
   const measured = useRef(new Set<HTMLElement>());
   const appearances = useRef(new Map<HTMLElement, Animation>());
   const previousFlow = useRef(flowResize);
   const previousLayout = useRef(layoutKey);
   const previousNavigation = useRef(navigationKey);
   // The signature the mounted cards were last animated for.
   const applied = useRef<unknown>(undefined);
   const view = useRef({ signature, viewKeys, navigationKey, layoutKey, flowResize });
   view.current = { signature, viewKeys, navigationKey, layoutKey, flowResize };
   const releaseRows = useCallback(() => {
      if (!motion.current?.active && !thumbnailMotion.current?.active) root.current?.style.removeProperty("grid-template-rows");
   }, [root]);
   const captureLayout = useCallback(() => {
      const grid = root.current;
      if (!grid) return;
      const bounds = grid.getBoundingClientRect();
      // Only cards and headers: a spacer's height is the grid's to set.
      const captures = mountedCards(grid).map(({ node }) => {
         const rect = node.getBoundingClientRect();
         // Offscreen thumbnails never animate, so skip measuring them.
         const thumbnail = offscreen(rect) ? null : node.querySelector<HTMLElement>(".clip-thumbnail");
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
      known.current = new Set();
      measured.current.clear();
      applied.current = undefined;
   }, [root]);
   const settle = useCallback(() => {
      const grid = root.current;
      if (!grid) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
         clear();
         return;
      }
      const { signature, viewKeys, navigationKey, layoutKey, flowResize } = view.current;
      if (
         applied.current === signature &&
         previousLayout.current === layoutKey &&
         previousNavigation.current === navigationKey &&
         previousFlow.current === flowResize
      ) {
         // Scrolling changed which cards are mounted. Note where the new ones sit, so the next change can move them.
         const cards = mountedCards(grid);
         const active = new Set(cards.map((card) => card.node));
         const arrived = cards.filter((card) => !measured.current.has(card.node) && known.current.has(card.key));
         let left = false;
         for (const node of measured.current) {
            if (active.has(node)) continue;
            measured.current.delete(node);
            left = true;
         }
         if (!arrived.length && !left) return;
         const bounds = grid.getBoundingClientRect();
         for (const { node } of arrived) {
            const rect = node.getBoundingClientRect();
            motion.current?.to(node, { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height }, false, true);
            measured.current.add(node);
         }
         motion.current?.retain(active);
         return;
      }
      applied.current = signature;
      const layoutChanged = previousLayout.current !== layoutKey;
      const directFlow = !layoutChanged && (flowResize || previousFlow.current);
      previousFlow.current = flowResize;
      previousLayout.current = layoutKey;
      const navigated = previousNavigation.current !== navigationKey;
      previousNavigation.current = navigationKey;
      if (navigated) {
         clear();
         applied.current = signature;
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
      const active = new Set<HTMLElement>();
      const imageTargets: { node: HTMLElement; width: number; height: number; immediate: boolean }[] = [];
      const targets: { node: HTMLElement; left: number; top: number; width: number; height: number; enter: boolean; immediate: boolean }[] = [];
      // Read all layout positions before writing any compensating transforms.
      for (const { node, key } of mountedCards(grid)) {
         active.add(node);
         measured.current.add(node);
         const rect = node.getBoundingClientRect();
         const hidden = offscreen(rect);
         // Offscreen thumbnails never animate, so skip measuring them.
         const thumbnail = hidden ? null : node.querySelector<HTMLElement>(".clip-thumbnail");
         if (thumbnail) {
            const image = thumbnail.getBoundingClientRect();
            imageTargets.push({ node: thumbnail, width: image.width, height: image.height, immediate: directFlow });
         }
         targets.push({
            node,
            left: rect.left - bounds.left,
            top: rect.top - bounds.top,
            width: rect.width,
            height: rect.height,
            enter: !known.current.has(key) && (navigated || known.current.size > 0),
            immediate: directFlow || hidden,
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
      known.current = viewKeys;
   }, [root, clear, releaseRows]);
   // Without a visible grid there is nothing to move, and whatever shows next starts fresh.
   useLayoutEffect(() => {
      if (!root.current || !visible) clear();
   }, [root, signature, visible, clear]);
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
   /**
    * Runs `read` against the layout the grid has once its cards stop moving. Mid-glide, cards and
    * thumbnails carry sizes set by hand and the rows are pinned, so those step aside for the read.
    */
   const natural = useCallback(
      <Result>(read: () => Result): Result => {
         const grid = root.current;
         if (!grid || (!motion.current?.active && !thumbnailMotion.current?.active)) return read();
         const sized: { style: CSSStyleDeclaration; width: string; height: string; basis: string }[] = [];
         for (const node of measured.current)
            for (const element of [node, node.querySelector<HTMLElement>(".clip-thumbnail")]) {
               if (!element || (!element.style.width && !element.style.height)) continue;
               sized.push({ style: element.style, width: element.style.width, height: element.style.height, basis: element.style.flexBasis });
               paintGridThumbnail(element.style);
            }
         const pinned = !!grid.style.gridTemplateRows;
         grid.style.removeProperty("grid-template-rows");
         const result = read();
         // The pin is taken again from this layout, so it always describes the rows mounted now.
         if (pinned) grid.style.gridTemplateRows = getComputedStyle(grid).gridTemplateRows;
         for (const { style, width, height, basis } of sized) {
            style.width = width;
            style.height = height;
            style.flexBasis = basis;
         }
         return result;
      },
      [root]
   );
   return { captureLayout, settle, natural };
}
