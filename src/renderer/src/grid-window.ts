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
 * Sizes corrected by the heights the browser gave the mounted rows, `first` onwards. Rows that
 * mix cards and placeholders say nothing about either, so they are skipped.
 */
export function measuredSizes(sizes: GridSizes, rows: readonly GridRow[], first: number, heights: readonly number[]): GridSizes {
   const next = { ...sizes };
   heights.forEach((height, offset) => {
      const row = rows[first + offset];
      if (!row) return;
      if (row.header) next[first + offset === 0 ? "firstHeader" : "header"] = height;
      else if (row.cards !== row.placeholders) next[row.cards ? "card" : "placeholder"] = height;
   });
   return next;
}

/** Where each row starts, with one more entry for where a row after the last would start. */
export function rowOffsets(rows: readonly GridRow[], sizes: GridSizes): number[] {
   const offsets = new Array<number>(rows.length + 1);
   let top = 0;
   rows.forEach((row, index) => {
      offsets[index] = top;
      top += rowHeight(row, index, sizes) + sizes.gap;
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
