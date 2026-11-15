export function menuPosition(
   anchor: { left: number; right: number; top: number; bottom: number },
   size: { width: number; height: number },
   viewport: { width: number; height: number },
   context?: { left: number; top: number } | null
) {
   const left = Math.max(8, Math.min(viewport.width - size.width - 8, context?.left ?? anchor.right - size.width));
   const top = context
      ? Math.max(8, Math.min(viewport.height - size.height - 8, context.top))
      : anchor.bottom + size.height + 8 > viewport.height
        ? Math.max(8, anchor.top - size.height - 5)
        : anchor.bottom + 5;
   const x = Math.max(0, Math.min(size.width, (context?.left ?? anchor.right) - left));
   const y = Math.max(0, Math.min(size.height, (context?.top ?? (top < anchor.top ? anchor.top : anchor.bottom)) - top));
   return { left, top, transformOrigin: `${x}px ${y}px` };
}
export function submenuPosition(
   anchor: { left: number; right: number; top: number; bottom: number },
   size: { width: number; height: number },
   viewport: { width: number; height: number }
) {
   const right = anchor.right + 4;
   const left = Math.max(8, Math.min(viewport.width - size.width - 8, right + size.width + 8 <= viewport.width ? right : anchor.left - size.width - 4));
   const top = Math.max(8, Math.min(viewport.height - size.height - 8, anchor.top));
   const x = left >= anchor.right ? 0 : size.width;
   const y = Math.max(0, Math.min(size.height, (anchor.top + anchor.bottom) / 2 - top));
   return { left, top, transformOrigin: `${x}px ${y}px` };
}

type Point = { x: number; y: number };
type Rect = { left: number; right: number; top: number; bottom: number };

/**
 * The region a pointer crosses while heading from a submenu trigger to its panel: a wedge from where it left the
 * trigger to the panel's near edge, plus the panel itself. Staying inside it means the user is still aiming.
 */
export function submenuAimArea(exit: Point, trigger: Rect, panel: Rect): Point[] {
   const right = panel.left >= (trigger.left + trigger.right) / 2;
   const near = right ? panel.left : panel.right;
   const far = right ? panel.right : panel.left;
   // A little slack behind the exit point absorbs the pointer's first, slightly crooked step.
   const start = exit.x + (right ? -6 : 6);
   return [
      { x: start, y: exit.y - 4 },
      { x: near, y: panel.top },
      { x: far, y: panel.top },
      { x: far, y: panel.bottom },
      { x: near, y: panel.bottom },
      { x: start, y: exit.y + 4 },
   ];
}
export function insidePolygon(point: Point, polygon: Point[]) {
   let inside = false;
   for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[index],
         b = polygon[previous];
      if (!a || !b) continue;
      if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
   }
   return inside;
}
