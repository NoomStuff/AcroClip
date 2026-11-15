/** How a grid child takes up space: a header spans its row, cards and placeholders share rows. */
export type GridItemKind = "header" | "card" | "placeholder";

export interface GridRow {
   /** The row holds items `start` up to, not including, `end`. */
   start: number;
   end: number;
   header: boolean;
   cards: boolean;
   placeholders: boolean;
}

/** Row heights in pixels, margins included. The grid's first child has no space above it, so a header there is shorter. */
export interface GridSizes {
   columns: number;
   gap: number;
   card: number;
   placeholder: number;
   header: number;
   firstHeader: number;
}

/** Packs items into the rows CSS grid puts them in: a header alone, everything else `columns` to a row. */
export function gridRows(kinds: readonly GridItemKind[], columns: number): GridRow[] {
   const rows: GridRow[] = [];
   const width = Math.max(1, Math.floor(columns));
   let open: GridRow | undefined;
   kinds.forEach((kind, index) => {
      if (kind === "header") {
         rows.push({ start: index, end: index + 1, header: true, cards: false, placeholders: false });
         open = undefined;
         return;
      }
      if (!open || open.end - open.start >= width) {
         open = { start: index, end: index, header: false, cards: false, placeholders: false };
         rows.push(open);
      }
      open.end = index + 1;
      if (kind === "card") open.cards = true;
      else open.placeholders = true;
   });
   return rows;
}

function rowHeight(row: GridRow, index: number, sizes: GridSizes): number {
   if (row.header) return index === 0 ? sizes.firstHeader : sizes.header;
   return Math.max(row.cards ? sizes.card : 0, row.placeholders ? sizes.placeholder : 0);
}

/**
 * What the grid knows about row heights. Mounted rows report their real height, kept by what
 * they hold, so a row scrolled away keeps its place. Rows never mounted use the estimates.
 */
export interface GridMeasure {
   sizes: GridSizes;
   /** Estimates taken from a real row. Each is learned once per layout, so a window that moves can't move them again. */
   learned: ReadonlySet<keyof GridSizes>;
   heights: ReadonlyMap<string, number>;
}

/** Identifies a row by the items it holds. The grid's first row has no space above it, so it is told apart. */
export function rowKey(row: GridRow, index: number, keyAt: (index: number) => string): string {
   const keys: string[] = index === 0 ? ["^"] : [];
   for (let item = row.start; item < row.end; item++) keys.push(keyAt(item));
   return keys.join("\n");
}

function estimateFor(row: GridRow, index: number): keyof GridSizes | undefined {
   if (row.header) return index === 0 ? "firstHeader" : "header";
   // Rows that mix cards and placeholders say nothing about either.
   if (row.cards !== row.placeholders) return row.cards ? "card" : "placeholder";
   return undefined;
}

/**
 * The measure with the heights the browser gave the mounted rows, `first` onwards. Returns the
 * same measure when nothing moved by more than half a pixel, which is when the layout has settled.
 */
export function measuredRows(measure: GridMeasure, rows: readonly GridRow[], keys: readonly string[], first: number, heights: readonly number[]): GridMeasure {
   let sizes: GridSizes | undefined, learned: Set<keyof GridSizes> | undefined, known: Map<string, number> | undefined;
   heights.forEach((height, offset) => {
      const index = first + offset,
         row = rows[index],
         key = keys[index];
      if (!row || key === undefined || !Number.isFinite(height)) return;
      const previous = (known ?? measure.heights).get(key);
      if (previous === undefined || Math.abs(previous - height) > 0.5) (known ??= new Map(measure.heights)).set(key, height);
      const estimate = estimateFor(row, index);
      if (estimate && !(learned ?? measure.learned).has(estimate)) {
         (learned ??= new Set(measure.learned)).add(estimate);
         if (Math.abs(measure.sizes[estimate] - height) > 0.5) (sizes ??= { ...measure.sizes })[estimate] = height;
      }
   });
   if (!sizes && !learned && !known) return measure;
   return { sizes: sizes ?? measure.sizes, learned: learned ?? measure.learned, heights: known ?? measure.heights };
}

/** Where each row starts, with one more entry for where a row after the last would start. A row's known height wins over the estimate. */
export function rowOffsets(rows: readonly GridRow[], sizes: GridSizes, known?: (index: number) => number | undefined): number[] {
   const offsets = new Array<number>(rows.length + 1);
   let top = 0;
   rows.forEach((row, index) => {
      offsets[index] = top;
      top += (known?.(index) ?? rowHeight(row, index, sizes)) + sizes.gap;
   });
   offsets[rows.length] = top;
   return offsets;
}

/** The rows that overlap `top` to `bottom`, as a start and an exclusive end. */
export function rowsInView(offsets: readonly number[], top: number, bottom: number): { first: number; end: number } {
   const count = offsets.length - 1;
   if (count <= 0) return { first: 0, end: 0 };
   // The last row starting at or before `position`.
   const rowAt = (position: number) => {
      let low = 0,
         high = count - 1;
      while (low < high) {
         const middle = (low + high + 1) >> 1;
         if (offsets[middle]! <= position) low = middle;
         else high = middle - 1;
      }
      return low;
   };
   const first = rowAt(Math.max(0, top));
   return { first, end: Math.max(first + 1, rowAt(Math.max(0, bottom)) + 1) };
}

/** Where an item's slot starts, relative to the grid's top left corner. */
export interface GridPlace {
   left: number;
   top: number;
}

/**
 * Looks up where each item's slot sits in one layout, mounted or not. `columns` holds where each
 * column starts. The lookup is built on first use, so a layout nobody asks about costs nothing.
 */
export function gridPlaces(keyAt: (index: number) => string, rows: readonly GridRow[], offsets: readonly number[], columns: readonly number[]) {
   let places: Map<string, GridPlace> | undefined;
   return (key: string): GridPlace | undefined => {
      if (!places) {
         places = new Map();
         rows.forEach((row, index) => {
            for (let item = row.start; item < row.end; item++) {
               const left = columns[item - row.start];
               if (left !== undefined) places!.set(keyAt(item), { left, top: offsets[index]! });
            }
         });
      }
      return places.get(key);
   };
}
