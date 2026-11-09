import { useCallback, useState } from "react";
import type { FocusEvent, PointerEvent } from "react";

const items = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** One highlight glides between a menu's items instead of each item lighting up on its own. */
export function useMenuHighlight() {
   const [box, setBox] = useState<{ x: number; y: number; width: number; height: number; instant: boolean } | null>(null);
   const point = (container: HTMLElement, target: EventTarget | null) => {
      const item = target instanceof Element ? target.closest<HTMLElement>(items) : null;
      // Events from portaled submenus bubble through React, so ignore items in other panels.
      if (!item || item.matches(":disabled") || item.closest('[role="menu"], [role="listbox"]') !== container) return;
      // Layout offsets ignore transforms, so the menu's open animation cannot skew the measurement.
      let x = 0,
         y = 0,
         node: HTMLElement | null = item;
      while (node && node !== container) {
         x += node.offsetLeft;
         y += node.offsetTop;
         node = node.offsetParent as HTMLElement | null;
      }
      if (node !== container) return;
      const next = { x, y, width: item.offsetWidth, height: item.offsetHeight };
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
   const clear = useCallback(() => setBox(null), []);
   return { handlers, highlight, clear };
}
