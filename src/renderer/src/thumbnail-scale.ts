export function gridZoomRange(width: number, gap: number, size: number, min = 220, max = 440) {
   const columnsAt = (value: number) => Math.max(1, Math.floor((width + gap) / (value + gap) + 1e-9));
   const most = columnsAt(min),
      fewest = columnsAt(max);
   const columns = Math.max(fewest, Math.min(most, columnsAt(size)));
   const sizes = Array.from({ length: most - fewest + 1 }, (_, index) =>
      // Round down so the requested number of columns still fits at fractional widths.
      Math.max(min, Math.min(max, Math.floor((width + gap) / (most - index) - gap + 1e-9)))
   );
   return { min: 0, max: most - fewest, value: most - columns, columns, pixels: Math.max(0, (width + gap) / columns - gap), sizes };
}

export function gridZoomTarget(width: number, gap: number, size: number, direction: -1 | 1, min = 220, max = 440): number | null {
   if (width <= 0) return null;
   const range = gridZoomRange(width, gap, size, min, max);
   return range.sizes[range.value + direction] ?? null;
}
