import { useEffect, useRef, useState } from "react";

interface Viewport {
   observer: IntersectionObserver;
   listeners: Map<Element, (visible: boolean) => void>;
}
const viewports = new WeakMap<Element, Viewport>();

// One observer per scroller. Keep image decoding near the viewport without
// removing cards, changing scroll geometry, or losing keyboard/search targets.
export function useThumbnailVisibility() {
   const ref = useRef<HTMLDivElement>(null);
   const [visible, setVisible] = useState(false);
   useEffect(() => {
      const node = ref.current;
      const root = node?.closest(".library-scroll");
      if (!node || !root) return;
      let viewport = viewports.get(root);
      if (!viewport) {
         const listeners = new Map<Element, (visible: boolean) => void>();
         const observer = new IntersectionObserver(
            (entries) => {
               for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
            },
            { root, rootMargin: "600px 0px" }
         );
         viewport = { observer, listeners };
         viewports.set(root, viewport);
      }
      viewport.listeners.set(node, setVisible);
      viewport.observer.observe(node);
      return () => {
         viewport.listeners.delete(node);
         viewport.observer.unobserve(node);
         if (!viewport.listeners.size) {
            viewport.observer.disconnect();
            viewports.delete(root);
         }
      };
   }, []);
   return { ref, visible };
}
