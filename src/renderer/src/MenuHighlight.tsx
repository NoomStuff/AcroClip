import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";

const items = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

type Box = { x: number; y: number; width: number; height: number; instant: boolean };

// Layout offsets ignore transforms, so the menu's open animation cannot skew the measurement.
function measure(container: HTMLElement, item: HTMLElement): Omit<Box, "instant"> | null {
   let x = 0,
      y = 0,
      node: HTMLElement | null = item;
   while (node && node !== container) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
   }
   return node === container ? { x, y, width: item.offsetWidth, height: item.offsetHeight } : null;
}

/** One highlight glides between a menu's items instead of each item lighting up on its own. */
export function useMenuHighlight() {
   const [box, setBox] = useState<Box | null>(null);
   const target = useRef<{ container: HTMLElement; item: HTMLElement } | null>(null);
   const observer = useRef<ResizeObserver | null>(null);
   const watched = useRef<HTMLElement | null>(null);
   useEffect(() => () => observer.current?.disconnect(), []);
   const point = (container: HTMLElement, node: EventTarget | null) => {
      const item = node instanceof Element ? node.closest<HTMLElement>(items) : null;
      // Events from portaled submenus bubble through React, so ignore items in other panels.
      if (!item || item.matches(":disabled") || item.closest('[role="menu"], [role="listbox"]') !== container) return;
      const next = measure(container, item);
      if (!next) return;
      target.current = { container, item };
      // A menu can still be settling its width when the first item is focused, so measure again whenever it resizes.
      if (watched.current !== container) {
         observer.current?.disconnect();
         observer.current = new ResizeObserver(() => {
            const current = target.current;
            const box = current?.item.isConnected ? measure(current.container, current.item) : null;
            if (box) setBox((shown) => (shown ? { ...box, instant: true } : shown));
         });
         observer.current.observe(container);
         watched.current = container;
      }
      setBox((current) => ({ ...next, instant: current === null }));
   };
   const handlers = {
      onPointerOver: (event: PointerEvent<HTMLElement>) => point(event.currentTarget, event.target),
      onFocus: (event: FocusEvent<HTMLElement>) => point(event.currentTarget, event.target),
      onPointerLeave: (event: PointerEvent<HTMLElement>) => {
         // Keyboard users keep the highlight on the focused item when the pointer wanders off.
         if (!event.currentTarget.contains(document.activeElement) || !document.documentElement.hasAttribute("data-keyboard")) setBox(null);
      },
   };
   const highlight = (
      <span
         className="menu-highlight"
         aria-hidden="true"
         data-visible={box ? true : undefined}
         data-instant={box?.instant || undefined}
         style={box ? { transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height } : undefined}
      />
   );
   const clear = useCallback(() => {
      target.current = null;
      observer.current?.disconnect();
      watched.current = null;
      setBox(null);
   }, []);
   return { handlers, highlight, clear };
}
