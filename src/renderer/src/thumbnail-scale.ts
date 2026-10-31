export function gridZoomTarget(width: number, gap: number, size: number, direction: -1 | 1, min = 220, max = 440): number | null {
   if (width <= 0) return null;
   const columnsAt = (value: number) => Math.max(1, Math.floor((width + gap) / (value + gap) + 1e-9));
   const columns = columnsAt(size) - direction;
   if (columns < columnsAt(max) || columns > columnsAt(min)) return null;
   // Round down so the requested number of columns still fits at fractional widths.
   return Math.max(min, Math.min(max, Math.floor((width + gap) / columns - gap + 1e-9)));
}
