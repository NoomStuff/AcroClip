import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Any element with data-tooltip gets this tooltip instead of the browser's.
// data-tooltip-overflow shows it only while the element's text is cut off.
// data-tooltip-side="right" places it beside the element, for the navigation rail.
const showDelay = 500;
// Moving between items shortly after a tooltip closes shows the next one at once.
const warmWindow = 400;

function truncated(element: HTMLElement): boolean {
   if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) return true;
   return Array.from(element.querySelectorAll<HTMLElement>("*")).some((child) => child.clientWidth > 0 && child.scrollWidth > child.clientWidth + 1);
}

function tooltipTarget(node: EventTarget | null): HTMLElement | null {
   const element = node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null;
   if (!element?.dataset["tooltip"]) return null;
   if (element.hasAttribute("data-tooltip-overflow") && !truncated(element)) return null;
   return element;
}

interface Shown {
   text: string;
   anchor: DOMRect;
   side: "above" | "below" | "right";
}

export function TooltipLayer() {
   const [shown, setShown] = useState<Shown | null>(null);
   const [position, setPosition] = useState<{ left: number; top: number; side: Shown["side"] } | null>(null);
   const bubble = useRef<HTMLDivElement>(null);
   useEffect(() => {
      let current: HTMLElement | null = null;
      let timer: number | undefined;
      let closedAt = 0;
      let visible = false;
      const hide = () => {
         window.clearTimeout(timer);
         if (visible) closedAt = performance.now();
         visible = false;
         current = null;
         setShown(null);
      };
      const show = (element: HTMLElement) => {
         const text = element.dataset["tooltip"];
         if (!text || !element.isConnected) return;
         visible = true;
         setShown({ text, anchor: element.getBoundingClientRect(), side: element.dataset["tooltipSide"] === "right" ? "right" : "above" });
      };
      const enter = (element: HTMLElement | null) => {
         if (element === current) return;
         window.clearTimeout(timer);
         const warm = visible || performance.now() - closedAt < warmWindow;
         if (visible) closedAt = performance.now();
         visible = false;
         setShown(null);
         current = element;
         if (!element) return;
         if (warm) show(element);
         else timer = window.setTimeout(() => show(element), showDelay);
      };
      const over = (event: PointerEvent) => {
         if (event.pointerType === "touch" || event.buttons) return;
         enter(tooltipTarget(event.target));
      };
      const focus = (event: FocusEvent) => {
         // Keyboard focus shows tooltips too, but a click's focus should not.
         if (document.documentElement.hasAttribute("data-keyboard")) enter(tooltipTarget(event.target));
      };
      const key = (event: KeyboardEvent) => {
         if (event.key === "Escape") hide();
      };
      document.addEventListener("pointerover", over);
      document.addEventListener("focusin", focus);
      document.addEventListener("focusout", hide);
      document.addEventListener("pointerdown", hide, true);
      document.addEventListener("wheel", hide, { passive: true, capture: true });
      document.addEventListener("scroll", hide, true);
      document.addEventListener("keydown", key, true);
      window.addEventListener("blur", hide);
      document.documentElement.addEventListener("pointerleave", hide);
      return () => {
         window.clearTimeout(timer);
         document.removeEventListener("pointerover", over);
         document.removeEventListener("focusin", focus);
         document.removeEventListener("focusout", hide);
         document.removeEventListener("pointerdown", hide, true);
         document.removeEventListener("wheel", hide, true);
         document.removeEventListener("scroll", hide, true);
         document.removeEventListener("keydown", key, true);
         window.removeEventListener("blur", hide);
         document.documentElement.removeEventListener("pointerleave", hide);
      };
   }, []);
   useLayoutEffect(() => {
      const node = bubble.current;
      if (!shown || !node) {
         setPosition(null);
         return;
      }
      const { width, height } = node.getBoundingClientRect();
      const gap = 8,
         edge = 8;
      const { anchor } = shown;
      const clampX = (left: number) => Math.min(window.innerWidth - width - edge, Math.max(edge, left));
      const clampY = (top: number) => Math.min(window.innerHeight - height - edge, Math.max(edge, top));
      if (shown.side === "right" && anchor.right + gap + width <= window.innerWidth - edge) {
         setPosition({ left: anchor.right + gap, top: clampY(anchor.top + anchor.height / 2 - height / 2), side: "right" });
         return;
      }
      const above = anchor.top - gap - height >= edge;
      setPosition({
         left: clampX(anchor.left + anchor.width / 2 - width / 2),
         top: above ? anchor.top - gap - height : anchor.bottom + gap,
         side: above ? "above" : "below",
      });
   }, [shown]);
   if (!shown) return null;
   return createPortal(
      <div
         ref={bubble}
         className="tooltip"
         role="tooltip"
         data-side={position?.side}
         style={position ? { left: position.left, top: position.top } : { left: 0, top: 0, visibility: "hidden" }}
      >
         {shown.text}
      </div>,
      document.fullscreenElement ?? document.body
   );
}
