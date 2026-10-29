import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

// Bound measurements and animations so filtering a large collection stays cheap.
export function useGridMotion<T extends HTMLElement>(root: RefObject<T | null>, signature: string, visible: boolean) {
   const positions = useRef(new Map<string, { left: number; top: number }>());
   const animations = useRef(new Map<HTMLElement, Animation>());
   useLayoutEffect(() => {
      const grid = root.current;
      if (!grid || !visible || matchMedia("(prefers-reduced-motion: reduce)").matches) {
         for (const animation of animations.current.values()) animation.cancel();
         animations.current.clear();
         positions.current.clear();
         return;
      }
      const bounds = grid.getBoundingClientRect();
      const next = new Map<string, { left: number; top: number }>();
      const moves: { node: HTMLElement; left: number; top: number; enter: boolean }[] = [];
      const active = new Set<HTMLElement>();
      for (let i = 0; i < Math.min(grid.children.length, 120); i++) {
         const node = grid.children[i] as HTMLElement;
         const key = node.dataset["layoutKey"];
         if (!key) continue;
         active.add(node);
         const rect = node.getBoundingClientRect();
         const transform = getComputedStyle(node).transform;
         const matrix = transform === "none" ? undefined : new DOMMatrixReadOnly(transform);
         const left = rect.left - bounds.left - (matrix?.m41 ?? 0),
            top = rect.top - bounds.top - (matrix?.m42 ?? 0);
         const previous = positions.current.get(key);
         next.set(key, { left, top });
         if (rect.bottom < 0 || rect.top > innerHeight) continue;
         if (previous) {
            const dx = previous.left + (matrix?.m41 ?? 0) - left,
               dy = previous.top + (matrix?.m42 ?? 0) - top;
            if (Math.abs(dx) + Math.abs(dy) > 0.5) moves.push({ node, left: dx, top: dy, enter: false });
         } else if (positions.current.size) moves.push({ node, left: 0, top: 6, enter: true });
      }
      for (const [node, animation] of animations.current) {
         if (!active.has(node) || moves.some((move) => move.node === node)) {
            animation.cancel();
            animations.current.delete(node);
         }
      }
      for (const move of moves) {
         const animation = move.node.animate(
            [
               { transform: `translate(${move.left}px, ${move.top}px)`, opacity: move.enter ? 0 : 1 },
               { transform: "translate(0, 0)", opacity: 1 },
            ],
            { duration: 220, easing: "cubic-bezier(.22,.8,.3,1)" }
         );
         animations.current.set(move.node, animation);
         animation.onfinish = () => {
            if (animations.current.get(move.node) === animation) animations.current.delete(move.node);
         };
      }
      positions.current = next;
   }, [root, signature, visible]);
   useLayoutEffect(
      () => () => {
         for (const animation of animations.current.values()) animation.cancel();
      },
      []
   );
}
