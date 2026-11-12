import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { gridRows, measuredSizes, rowOffsets, rowsInView } from "./grid-window";
import type { GridItemKind, GridSizes } from "./grid-window";

// Rows this far outside the viewport stay mounted, so scrolling and Tab always land on a real card.
const overscan = 600;
// Until the first rows are measured. One render later the real sizes replace these.
const estimates: Record<"grid" | "list", GridSizes> = {
   grid: { columns: 3, gap: 18, card: 240, placeholder: 215, header: 23, firstHeader: 9 },
   list: { columns: 1, gap: 2, card: 92, placeholder: 92, header: 35, firstHeader: 21 },
};

/**
 * The library's grid, with only the rows near the viewport mounted. Spacers stand in for the
 * rest, so the scrollbar and every card's position match a grid that held them all.
 */
export function LibraryGrid<Item>({
   grid,
   scroller,
   view,
   visible,
   items,
   kind,
   render,
   natural,
   onSettled,
}: {
   grid: RefObject<HTMLDivElement | null>;
   scroller: RefObject<HTMLElement | null>;
   view: "grid" | "list";
   visible: boolean;
   items: readonly Item[];
   kind: (item: Item) => GridItemKind;
   render: (item: Item) => ReactNode;
   /** Runs a read against the layout as it is once any card animation has finished. */
   natural: <Result>(read: () => Result) => Result;
   /** The mounted rows are laid out at their real sizes. Runs before paint. */
   onSettled: () => void;
}) {
   const [measured, setMeasured] = useState<{ view: "grid" | "list"; sizes: GridSizes } | null>(null);
   const sizes = measured?.view === view ? measured.sizes : estimates[view];
   const rows = useMemo(() => gridRows(items.map(kind), sizes.columns), [items, kind, sizes.columns]);
   const offsets = useMemo(() => rowOffsets(rows, sizes), [rows, sizes]);
   const [range, setRange] = useState({ first: 0, end: 0 });
   const first = Math.min(range.first, rows.length);
   const end = Math.min(Math.max(range.end, first), rows.length);
   const before = offsets[first]! - sizes.gap;
   const after = offsets[rows.length]! - offsets[end]! - sizes.gap;
   const current = useRef({ rows, offsets, sizes, view, first, end, before, natural, onSettled });
   current.current = { rows, offsets, sizes, view, first, end, before, natural, onSettled };
   /** Reads the grid's real layout and corrects the sizes or the window. Reports once neither needed correcting. */
   const update = useCallback(() => {
      const element = grid.current,
         viewport = scroller.current;
      // A hidden page has no layout to read. Its last window stays as it was.
      if (!element || !viewport || !viewport.clientHeight) return;
      const { rows, offsets, sizes, view, first, end, before, natural, onSettled } = current.current;
      const next = natural(() => {
         const style = getComputedStyle(element);
         // The browser's own row tracks: one per mounted row, after the spacer.
         const tracks = style.gridTemplateRows.split(" ").map(Number.parseFloat);
         const mounted = tracks.slice(before > 0 ? 1 : 0, (before > 0 ? 1 : 0) + end - first);
         return measuredSizes(
            { ...sizes, columns: Math.max(1, style.gridTemplateColumns.split(" ").length), gap: Number.parseFloat(style.rowGap) || 0 },
            rows,
            first,
            mounted.every(Number.isFinite) ? mounted : []
         );
      });
      if ((Object.keys(next) as Array<keyof GridSizes>).some((key) => Math.abs(next[key] - sizes[key]) > 0.5)) {
         // The rows are placed again with these sizes, and the pass after that render picks the window.
         setMeasured({ view, sizes: next });
         return;
      }
      // Where the viewport sits over the grid, which starts below the heading and breadcrumb.
      const top = viewport.getBoundingClientRect().top - element.getBoundingClientRect().top;
      const window = rowsInView(offsets, top - overscan, top + viewport.clientHeight + overscan);
      if (window.first === first && window.end === end) onSettled();
      else setRange(window);
   }, [grid, scroller]);
   // After every render, before paint: sizes can change with the view, the zoom or the window's width.
   useLayoutEffect(() => {
      if (visible) update();
   });
   useEffect(() => {
      const element = grid.current,
         viewport = scroller.current;
      if (!element || !viewport || !visible) return;
      viewport.addEventListener("scroll", update, { passive: true });
      // Focus scrolls its target into view at once. Following it here keeps the next row mounted for the next Tab.
      element.addEventListener("focusin", update);
      // The list's thumbnails resize over several frames without a render.
      const observer = new ResizeObserver(update);
      observer.observe(element);
      observer.observe(viewport);
      return () => {
         viewport.removeEventListener("scroll", update);
         element.removeEventListener("focusin", update);
         observer.disconnect();
      };
   }, [grid, scroller, visible, update]);
   const start = rows[first]?.start ?? items.length;
   const stop = end > first ? rows[end - 1]!.end : start;
   return (
      <div className="clip-grid" data-view={view} ref={grid}>
         {before > 0 && <div className="clip-grid-spacer" style={{ height: before }} aria-hidden="true" />}
         {items.slice(start, stop).map(render)}
         {after > 0 && <div className="clip-grid-spacer" style={{ height: after }} aria-hidden="true" />}
      </div>
   );
}
