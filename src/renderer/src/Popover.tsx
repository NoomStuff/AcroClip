import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

export type PopoverPlacement = "above" | "below";
export type PopoverAlign = "start" | "end";

/** Where a popover of this size goes next to its anchor, flipping sides when the preferred one has no room. */
export function popoverPosition(
   anchor: { left: number; right: number; top: number; bottom: number },
   size: { width: number; height: number },
   viewport: { width: number; height: number },
   placement: PopoverPlacement,
   align: PopoverAlign
) {
   const gap = 6,
      edge = 8;
   const fitsAbove = anchor.top - gap - size.height >= edge;
   const fitsBelow = anchor.bottom + gap + size.height <= viewport.height - edge;
   const above = placement === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
   const preferredLeft = align === "end" ? anchor.right - size.width : anchor.left;
   const left = Math.max(edge, Math.min(viewport.width - size.width - edge, preferredLeft));
   const top = above ? Math.max(edge, anchor.top - gap - size.height) : Math.min(viewport.height - size.height - edge, anchor.bottom + gap);
   // Grow out of the anchor's nearest corner.
   const originX = Math.max(0, Math.min(size.width, (align === "end" ? anchor.right : anchor.left) - left));
   return { left, top, transformOrigin: `${originX}px ${above ? size.height : 0}px`, side: above ? "above" : "below" } as const;
}

/**
 * The base for every anchored popover: placed against its anchor, animated like menus,
 * and dismissed by Escape or a press outside both the popover and its anchor.
 */
export function Popover({
   open,
   anchor,
   onClose,
   label,
   children,
   className = "",
   placement = "above",
   align = "end",
   panelRef,
}: {
   open: boolean;
   anchor: RefObject<HTMLElement | null>;
   onClose: () => void;
   label: string;
   children: ReactNode;
   className?: string;
   placement?: PopoverPlacement;
   align?: PopoverAlign;
   panelRef?: RefObject<HTMLDivElement | null>;
}) {
   const [phase, setPhase] = useState<"open" | "closing" | "closed">(open ? "open" : "closed");
   const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
   const panel = useRef<HTMLDivElement>(null);
   const latestClose = useRef(onClose);
   useLayoutEffect(() => {
      latestClose.current = onClose;
   });
   if (open && phase !== "open") setPhase("open");
   if (!open && phase === "open") setPhase("closing");
   useLayoutEffect(() => {
      if (phase === "closed") return;
      const place = () => {
         const node = panel.current,
            target = anchor.current;
         if (!node || !target) return;
         setPosition(
            popoverPosition(
               target.getBoundingClientRect(),
               { width: node.offsetWidth, height: node.offsetHeight },
               { width: window.innerWidth, height: window.innerHeight },
               placement,
               align
            )
         );
      };
      place();
      const observer = new ResizeObserver(place);
      if (panel.current) observer.observe(panel.current);
      if (anchor.current) observer.observe(anchor.current);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
      return () => {
         observer.disconnect();
         window.removeEventListener("resize", place);
         window.removeEventListener("scroll", place, true);
      };
   }, [phase, anchor, placement, align]);
   useEffect(() => {
      if (phase !== "open") return;
      const outside = (event: PointerEvent) => {
         const target = event.target as Node;
         if (!panel.current?.contains(target) && !anchor.current?.contains(target)) latestClose.current();
      };
      const key = (event: KeyboardEvent) => {
         if (event.key !== "Escape") return;
         event.stopPropagation();
         latestClose.current();
      };
      window.addEventListener("pointerdown", outside, true);
      window.addEventListener("keydown", key);
      return () => {
         window.removeEventListener("pointerdown", outside, true);
         window.removeEventListener("keydown", key);
      };
   }, [phase, anchor]);
   if (phase === "closed") return null;
   return createPortal(
      <div
         ref={(node) => {
            panel.current = node;
            if (panelRef) panelRef.current = node;
         }}
         className={`popover ${className}`}
         role="dialog"
         aria-label={label}
         data-side={position?.side}
         data-closing={phase === "closing" || undefined}
         inert={phase === "closing"}
         style={position ? { left: position.left, top: position.top, transformOrigin: position.transformOrigin } : { visibility: "hidden" }}
         onAnimationEnd={(event) => {
            if (phase === "closing" && event.target === event.currentTarget) setPhase("closed");
         }}
      >
         {children}
      </div>,
      document.fullscreenElement ?? document.body
   );
}
