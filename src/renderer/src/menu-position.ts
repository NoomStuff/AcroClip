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
