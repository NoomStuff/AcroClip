export type DockPanel = "preview" | "sources" | "mixer" | "actions";
export type DockAxis = "row" | "column";
export type DockNode = { panel: DockPanel } | { split: DockAxis; children: DockNode[]; sizes: number[] };
export type DockEdge = "left" | "right" | "top" | "bottom";
export type DockCorner = `${"top" | "bottom"}-${"left" | "right"}`;
export type DockSide = DockEdge | DockCorner | "center";
export interface Rect {
   x: number;
   y: number;
   width: number;
   height: number;
}
export interface DockDivider {
   path: number[];
   index: number;
   axis: DockAxis;
   rect: Rect;
   /** The split's sizes as laid out, which a drag starts from. */
   sizes: number[];
}
export type PanelMinimums = Record<DockPanel, { width: number; height: number }>;

export const dockPanels: readonly DockPanel[] = ["preview", "sources", "mixer", "actions"];
export const dockGap = 12;
/** The smallest each component stays usable at, wherever it is docked. */
export const panelMinimum: PanelMinimums = {
   preview: { width: 220, height: 140 },
   sources: { width: 200, height: 150 },
   mixer: { width: 300, height: 150 },
   actions: { width: 150, height: 120 },
};
export const defaultDock: DockNode = {
   split: "row",
   sizes: [700, 340],
   children: [
      { split: "column", sizes: [500, 250], children: [{ panel: "preview" }, { panel: "mixer" }] },
      { split: "column", sizes: [500, 250], children: [{ panel: "sources" }, { panel: "actions" }] },
   ],
};

const along = (axis: DockAxis, rect: Pick<Rect, "width" | "height">) => (axis === "row" ? rect.width : rect.height);
const contains = (node: DockNode, panel: DockPanel): boolean =>
   "panel" in node ? node.panel === panel : node.children.some((child) => contains(child, panel));
function panelsOf(node: DockNode): DockPanel[] {
   return "panel" in node ? [node.panel] : node.children.flatMap(panelsOf);
}

export function isDockLayout(value: unknown): value is DockNode {
   const valid = (node: unknown): boolean => {
      if (!node || typeof node !== "object") return false;
      const item = node as Record<string, unknown>;
      if (typeof item["panel"] === "string") return dockPanels.includes(item["panel"] as DockPanel);
      const { split, children, sizes } = item;
      return (
         (split === "row" || split === "column") &&
         Array.isArray(children) &&
         Array.isArray(sizes) &&
         children.length >= 2 &&
         sizes.length === children.length &&
         sizes.every((size) => typeof size === "number" && Number.isFinite(size)) &&
         children.every(valid)
      );
   };
   if (!valid(value)) return false;
   const panels = panelsOf(value as DockNode);
   return panels.length === dockPanels.length && dockPanels.every((panel) => panels.includes(panel));
}

export function minimumSize(node: DockNode, axis: DockAxis, minimums = panelMinimum): number {
   if ("panel" in node) return along(axis, minimums[node.panel]);
   const sizes = node.children.map((child) => minimumSize(child, axis, minimums));
   return node.split === axis ? sizes.reduce((total, size) => total + size, 0) + dockGap * (sizes.length - 1) : Math.max(...sizes);
}

/**
 * Fits a split's stored sizes into `length`. The child holding the preview takes up the difference,
 * so docked controls keep their size while the window changes. No child goes below its minimum.
 */
export function resolveSizes(node: Extract<DockNode, { split: DockAxis }>, length: number, limits = panelMinimum): number[] {
   const available = length - dockGap * (node.children.length - 1);
   const minimums = node.children.map((child) => minimumSize(child, node.split, limits));
   const sizes = node.sizes.map((size, index) => Math.max(minimums[index]!, size));
   const previewIndex = node.children.findIndex((child) => contains(child, "preview"));
   const flex = previewIndex >= 0 ? previewIndex : sizes.indexOf(Math.max(...sizes));
   sizes[flex] = sizes[flex]! + available - sizes.reduce((total, size) => total + size, 0);
   if (sizes[flex]! < minimums[flex]!) {
      let deficit = minimums[flex]! - sizes[flex]!;
      sizes[flex] = minimums[flex]!;
      for (let index = 0; index < sizes.length && deficit > 0; index++) {
         if (index === flex) continue;
         const take = Math.min(deficit, sizes[index]! - minimums[index]!);
         sizes[index] = sizes[index]! - take;
         deficit -= take;
      }
   }
   return sizes;
}

export function layoutDock(root: DockNode, bounds: Rect, minimums = panelMinimum): { panels: Record<DockPanel, Rect>; dividers: DockDivider[] } {
   const panels = {} as Record<DockPanel, Rect>;
   const dividers: DockDivider[] = [];
   const place = (node: DockNode, rect: Rect, path: number[]) => {
      if ("panel" in node) {
         panels[node.panel] = rect;
         return;
      }
      const sizes = resolveSizes(node, along(node.split, rect), minimums);
      let offset = node.split === "row" ? rect.x : rect.y;
      sizes.forEach((size, index) => {
         const child: Rect = node.split === "row" ? { ...rect, x: offset, width: size } : { ...rect, y: offset, height: size };
         place(node.children[index]!, child, [...path, index]);
         offset += size;
         if (index < sizes.length - 1) {
            dividers.push({
               path,
               index,
               axis: node.split,
               sizes,
               rect: node.split === "row" ? { ...rect, x: offset, width: dockGap } : { ...rect, y: offset, height: dockGap },
            });
            offset += dockGap;
         }
      });
   };
   place(root, bounds, []);
   return { panels, dividers };
}

function nodeAt(root: DockNode, path: readonly number[]): DockNode {
   return path.reduce<DockNode>((node, index) => ("panel" in node ? node : node.children[index]!), root);
}
function replaceAt(root: DockNode, path: readonly number[], next: DockNode): DockNode {
   if (!path.length || "panel" in root) return next;
   const [index, ...rest] = path;
   return { ...root, children: root.children.map((child, position) => (position === index ? replaceAt(child, rest, next) : child)) };
}

/** Moves the divider after child `index` of the split at `path` by `delta` pixels, within both neighbours' minimums. */
export function resizeDock(root: DockNode, divider: Pick<DockDivider, "path" | "index" | "sizes">, delta: number, minimums = panelMinimum): DockNode {
   const node = nodeAt(root, divider.path);
   if ("panel" in node) return root;
   const [low, high] = dividerLimits(root, divider, minimums);
   const move = Math.max(low, Math.min(high, delta));
   const sizes = [...divider.sizes];
   sizes[divider.index] = sizes[divider.index]! + move;
   sizes[divider.index + 1] = sizes[divider.index + 1]! - move;
   return replaceAt(root, divider.path, { ...node, sizes });
}

/** How far a divider can move back and forward before either neighbour reaches its minimum. */
export function dividerLimits(root: DockNode, divider: Pick<DockDivider, "path" | "index" | "sizes">, minimums = panelMinimum): [number, number] {
   const node = nodeAt(root, divider.path);
   if ("panel" in node) return [0, 0];
   const { index, sizes } = divider;
   return [
      minimumSize(node.children[index]!, node.split, minimums) - sizes[index]!,
      sizes[index + 1]! - minimumSize(node.children[index + 1]!, node.split, minimums),
   ];
}

export const dividerPosition = (divider: Pick<DockDivider, "axis" | "rect">) => (divider.axis === "row" ? divider.rect.x : divider.rect.y);
const crossSpan = (item: Pick<DockDivider, "axis" | "rect">): [number, number] =>
   item.axis === "row" ? [item.rect.y, item.rect.y + item.rect.height] : [item.rect.x, item.rect.x + item.rect.width];
const directDividers = (dividers: readonly DockDivider[], path: readonly number[]) => dividers.filter((other) => other.path.join(".") === path.join("."));

/** Where the splits on both sides of `divider` meet it at the same spot, making a crossing. */
function crossings(dividers: readonly DockDivider[], divider: DockDivider): number[] {
   const before = directDividers(dividers, [...divider.path, divider.index]).map(dividerPosition);
   const after = directDividers(dividers, [...divider.path, divider.index + 1]).map(dividerPosition);
   return before.filter((spot) => after.some((other) => Math.abs(other - spot) < 1)).sort((a, b) => a - b);
}

/** A draggable piece of a divider. Crossings cut a divider into arms that each move on their own. */
export interface DockSegment {
   divider: DockDivider;
   rect: Rect;
   /** True when the piece is an arm between crossings rather than the whole divider. */
   partial: boolean;
   /** Which arm of its divider this is, counted from the top or left. */
   piece: number;
}
export function dividerSegments(dividers: readonly DockDivider[]): DockSegment[] {
   return dividers.flatMap((divider): DockSegment[] => {
      const cuts = crossings(dividers, divider);
      if (!cuts.length) return [{ divider, rect: divider.rect, partial: false, piece: 0 }];
      const [start, end] = crossSpan(divider);
      const bounds = [start, ...cuts.flatMap((cut) => [cut, cut + dockGap]), end];
      return [...cuts, end].map((_, index) => {
         const from = bounds[index * 2]!;
         const to = bounds[index * 2 + 1]!;
         const rect = divider.axis === "row" ? { ...divider.rect, y: from, height: to - from } : { ...divider.rect, x: from, width: to - from };
         return { divider, rect, partial: true, piece: index };
      });
   });
}

/**
 * Gives the arm `segment` a divider of its own. The splits on both sides of its divider are cut at
 * every crossing and paired up, so the crossing lines join into one and the arms come apart.
 */
export function separateSegment(root: DockNode, bounds: Rect, segment: DockSegment, minimums = panelMinimum): { root: DockNode; divider: DockDivider } {
   const { divider } = segment;
   const node = nodeAt(root, divider.path);
   if (!segment.partial || "panel" in node) return { root, divider };
   const { dividers } = layoutDock(root, bounds, minimums);
   const cuts = crossings(dividers, divider);
   const across: DockAxis = divider.axis === "row" ? "column" : "row";
   const pieces = (index: number): Array<{ node: DockNode; size: number }> => {
      const child = node.children[index]!;
      const own = directDividers(dividers, [...divider.path, index]);
      if ("panel" in child || !own.length) return [{ node: child, size: 0 }];
      const sizes = own[0]!.sizes;
      const starts = [0, ...own.filter((item) => cuts.some((cut) => Math.abs(dividerPosition(item) - cut) < 1)).map((item) => item.index + 1)];
      return starts.map((from, at) => {
         const to = starts[at + 1] ?? child.children.length;
         const size = sizes.slice(from, to).reduce((sum, value) => sum + value, 0) + dockGap * (to - from - 1);
         return {
            node: to - from === 1 ? child.children[from]! : { split: across, children: child.children.slice(from, to), sizes: sizes.slice(from, to) },
            size,
         };
      });
   };
   const first = pieces(divider.index);
   const second = pieces(divider.index + 1);
   if (first.length !== second.length) return { root, divider };
   const paired: DockNode = {
      split: across,
      sizes: first.map((piece) => piece.size),
      children: first.map((piece, at) => ({
         split: divider.axis,
         children: [piece.node, second[at]!.node],
         sizes: [divider.sizes[divider.index]!, divider.sizes[divider.index + 1]!],
      })),
   };
   const children = [...node.children];
   const sizes = [...divider.sizes];
   children.splice(divider.index, 2, paired);
   sizes.splice(divider.index, 2, divider.sizes[divider.index]! + dockGap + divider.sizes[divider.index + 1]!);
   const next = flatten(replaceAt(root, divider.path, children.length === 1 ? paired : { ...node, children, sizes }));
   const [from, to] = crossSpan({ axis: divider.axis, rect: segment.rect });
   const middle = (from + to) / 2;
   const match = layoutDock(next, bounds, minimums).dividers.find((item) => {
      const [start, end] = crossSpan(item);
      return item.axis === divider.axis && Math.abs(dividerPosition(item) - dividerPosition(divider)) < 1 && start <= middle && middle <= end;
   });
   return match ? { root: next, divider: match } : { root, divider };
}

function removePanel(node: DockNode, panel: DockPanel): DockNode | null {
   if ("panel" in node) return node.panel === panel ? null : node;
   const kept = node.children.flatMap((child, index) => {
      const next = removePanel(child, panel);
      return next ? [{ child: next, size: node.sizes[index]! }] : [];
   });
   if (kept.length === 1) return kept[0]!.child;
   return { ...node, children: kept.map((item) => item.child), sizes: kept.map((item) => item.size) };
}
function swapPanels(node: DockNode, a: DockPanel, b: DockPanel): DockNode {
   if ("panel" in node) return node.panel === a ? { panel: b } : node.panel === b ? { panel: a } : node;
   return { ...node, children: node.children.map((child) => swapPanels(child, a, b)) };
}

/**
 * Docks `moving` against a side of `target`, or of the whole layout when `target` is "root".
 * `targetRect` is where the target sits now, which sets how much room the moved panel gets.
 */
export function dockPanel(root: DockNode, moving: DockPanel, target: DockPanel | "root", side: DockSide, targetRect: Rect, minimums = panelMinimum): DockNode {
   if (target === moving) return root;
   if (side === "center") return target === "root" ? root : swapPanels(root, moving, target);
   if (isCorner(side)) return dockCorner(root, moving, side, targetRect, minimums);
   const axis: DockAxis = side === "left" || side === "right" ? "row" : "column";
   const before = side === "left" || side === "top";
   const remaining = removePanel(root, moving)!;
   const length = along(axis, targetRect);
   const share = target === "root" ? Math.max(along(axis, minimums[moving]), Math.round(length / 3)) : (length - dockGap) / 2;
   const insert = (node: DockNode, rest: number): DockNode => ({
      split: axis,
      children: before ? [{ panel: moving }, node] : [node, { panel: moving }],
      sizes: before ? [share, rest] : [rest, share],
   });
   if (target === "root") {
      if ("split" in remaining && remaining.split === axis) {
         return {
            ...remaining,
            children: before ? [{ panel: moving }, ...remaining.children] : [...remaining.children, { panel: moving }],
            sizes: before ? [share, ...remaining.sizes] : [...remaining.sizes, share],
         };
      }
      return insert(remaining, length - share - dockGap);
   }
   const visit = (node: DockNode): DockNode => {
      if ("panel" in node) return node.panel === target ? insert(node, share) : node;
      const index = node.children.findIndex((child) => "panel" in child && child.panel === target);
      if (index >= 0 && node.split === axis) {
         const children = [...node.children];
         const sizes = [...node.sizes];
         children.splice(before ? index : index + 1, 0, { panel: moving });
         sizes[index] = share;
         sizes.splice(before ? index : index + 1, 0, share);
         return { ...node, children, sizes };
      }
      return { ...node, children: node.children.map(visit) };
   };
   return visit(remaining);
}

const isCorner = (side: DockSide): side is DockCorner => side.includes("-");
function parentAxis(node: DockNode, panel: DockPanel): DockAxis | null {
   if ("panel" in node) return null;
   if (node.children.some((child) => "panel" in child && child.panel === panel)) return node.split;
   for (const child of node.children) {
      const axis = parentAxis(child, panel);
      if (axis) return axis;
   }
   return null;
}

/**
 * Puts `moving` in a corner of the whole layout by docking it beside the panel that holds that corner.
 * It splits along that panel's own split, unless the panel spans the layout, where that would fill a full edge.
 */
function dockCorner(root: DockNode, moving: DockPanel, corner: DockCorner, bounds: Rect, minimums: PanelMinimums): DockNode {
   const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"];
   const remaining = removePanel(root, moving)!;
   const { panels } = layoutDock(remaining, bounds, minimums);
   const x = horizontal === "left" ? bounds.x : bounds.x + bounds.width;
   const y = vertical === "top" ? bounds.y : bounds.y + bounds.height;
   const distance = (rect: Rect) => Math.hypot(Math.max(rect.x - x, 0, x - rect.x - rect.width), Math.max(rect.y - y, 0, y - rect.y - rect.height));
   const holder = dockPanels.filter((panel) => panel !== moving).reduce((best, panel) => (distance(panels[panel]) < distance(panels[best]) ? panel : best));
   const rect = panels[holder];
   const axis = rect.width >= bounds.width - 1 ? "row" : rect.height >= bounds.height - 1 ? "column" : (parentAxis(remaining, holder) ?? "column");
   return dockPanel(remaining, moving, holder, axis === "row" ? horizontal : vertical, rect, minimums);
}

export interface DockDrop {
   target: DockPanel | "root";
   side: DockSide;
   /** The layout after the drop, and where the moved panel ends up in it. */
   next: DockNode;
   preview: Rect;
}

/** Where a drag at (x, y) would put `moving`, worked out by laying out the result. */
export function planDrop(root: DockNode, bounds: Rect, moving: DockPanel, x: number, y: number, minimums = panelMinimum): DockDrop | null {
   const { panels } = layoutDock(root, bounds, minimums);
   const hit = dropTarget(panels, bounds, moving, x, y);
   if (!hit) return null;
   const result = (drop: DropHit) => flatten(dockPanel(root, moving, drop.target, drop.side, drop.targetRect, minimums));
   const next = result(hit);
   const key = shape(next);
   if (key === shape(flatten(root))) return null;
   // Zones that end in the same arrangement share one name and one result: the first in this list.
   const named = hit.side === "center" ? hit : (namedDrops(panels, bounds, moving).find((drop) => shape(result(drop)) === key) ?? hit);
   const chosen = named === hit ? next : result(named);
   return { target: named.target, side: named.side, next: chosen, preview: layoutDock(chosen, bounds, minimums).panels[moving] };
}

type DropHit = { target: DockPanel | "root"; side: DockSide; targetRect: Rect };
const edges: readonly DockEdge[] = ["left", "right", "top", "bottom"];
const corners: readonly DockCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
function namedDrops(rects: Record<DockPanel, Rect>, bounds: Rect, moving: DockPanel): DropHit[] {
   return [
      ...edges.map((side) => ({ target: "root" as const, side, targetRect: bounds })),
      ...dockPanels.filter((panel) => panel !== moving).flatMap((panel) => edges.map((side) => ({ target: panel, side, targetRect: rects[panel] }))),
      ...corners.map((side) => ({ target: "root" as const, side, targetRect: bounds })),
   ];
}
const shape = (node: DockNode): string => ("panel" in node ? node.panel : `${node.split}(${node.children.map(shape).join(",")})`);

/** Lifts a split's children into a parent split along the same axis, scaling their sizes to the slot they shared. */
function flatten(node: DockNode): DockNode {
   if ("panel" in node) return node;
   const children: DockNode[] = [];
   const sizes: number[] = [];
   node.children.forEach((raw, index) => {
      const child = flatten(raw);
      const size = node.sizes[index]!;
      if ("panel" in child || child.split !== node.split) {
         children.push(child);
         sizes.push(size);
         return;
      }
      const inner = size - dockGap * (child.children.length - 1);
      const total = child.sizes.reduce((sum, value) => sum + value, 0);
      child.children.forEach((grandchild, at) => {
         children.push(grandchild);
         sizes.push(total > 0 ? (child.sizes[at]! / total) * inner : inner / child.children.length);
      });
   });
   return { split: node.split, children, sizes };
}

/** Which part of the layout a drag at (x, y) points at. */
export function dropTarget(rects: Record<DockPanel, Rect>, bounds: Rect, moving: DockPanel, x: number, y: number): DropHit | null {
   const edge = 22;
   const corner = 96;
   const outer: Array<[DockEdge, number]> = [
      ["left", x - bounds.x],
      ["right", bounds.x + bounds.width - x],
      ["top", y - bounds.y],
      ["bottom", bounds.y + bounds.height - y],
   ];
   const [outerSide, outerDistance] = outer.reduce((best, item) => (item[1] < best[1] ? item : best));
   if (outerDistance >= 0 && outerDistance < edge) {
      const [horizontal, horizontalDistance] = outer[0]![1] < outer[1]![1] ? outer[0]! : outer[1]!;
      const [vertical, verticalDistance] = outer[2]![1] < outer[3]![1] ? outer[2]! : outer[3]!;
      if (horizontalDistance < corner && verticalDistance < corner)
         return { target: "root", side: `${vertical}-${horizontal}` as DockCorner, targetRect: bounds };
      return { target: "root", side: outerSide, targetRect: bounds };
   }
   for (const panel of dockPanels) {
      const rect = rects[panel];
      if (!rect || x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue;
      if (panel === moving) return null;
      const relative: Array<[DockEdge, number]> = [
         ["left", (x - rect.x) / rect.width],
         ["right", (rect.x + rect.width - x) / rect.width],
         ["top", (y - rect.y) / rect.height],
         ["bottom", (rect.y + rect.height - y) / rect.height],
      ];
      const [side, distance] = relative.reduce((best, item) => (item[1] < best[1] ? item : best));
      return { target: panel, side: distance > 0.3 ? "center" : side, targetRect: rect };
   }
   return null;
}
