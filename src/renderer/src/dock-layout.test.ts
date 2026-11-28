import { describe, expect, it } from "vitest";
import {
   defaultDock,
   dockFromSizes,
   dockCrossings,
   dockLines,
   lineDividers,
   neighbourPanel,
   dockPanel,
   dividerSegments,
   dropTarget,
   isDockLayout,
   layoutDock,
   panelMinimum,
   planDrop,
   resizeDock,
   resolveSizes,
   separateSegment,
} from "./dock-layout";
import type { DockNode } from "./dock-layout";

const bounds = { x: 0, y: 0, width: 1200, height: 800 };

describe("dock layout", () => {
   it("gives the preview the space the docked controls don't use", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      expect(panels.sources.width).toBe(340);
      expect(panels.preview.width).toBe(1200 - 340 - 12);
      expect(panels.mixer.height).toBe(250);
      expect(panels.preview.height).toBe(800 - 250 - 12);
   });

   it("keeps every panel at its own minimum when the window is small", () => {
      const { panels } = layoutDock(defaultDock, { x: 0, y: 0, width: 600, height: 340 });
      expect(panels.preview.width).toBeGreaterThanOrEqual(panelMinimum.mixer.width);
      expect(panels.sources.width).toBeGreaterThanOrEqual(panelMinimum.sources.width);
      expect(panels.mixer.height).toBeGreaterThanOrEqual(panelMinimum.mixer.height);
   });

   it("stacks any number of panels in one column", () => {
      let layout: DockNode = defaultDock;
      const rects = () => layoutDock(layout, bounds).panels;
      layout = dockPanel(layout, "sources", "root", "right", bounds);
      layout = dockPanel(layout, "mixer", "sources", "bottom", rects().sources);
      layout = dockPanel(layout, "actions", "mixer", "bottom", rects().mixer);
      expect(isDockLayout(layout)).toBe(true);
      const placed = rects();
      expect(placed.sources.x).toBe(placed.mixer.x);
      expect(placed.mixer.x).toBe(placed.actions.x);
      expect(placed.sources.y).toBeLessThan(placed.mixer.y);
      expect(placed.mixer.y).toBeLessThan(placed.actions.y);
      expect(placed.preview.height).toBe(800);
   });

   it("swaps two panels when dropped on the middle", () => {
      const swapped = dockPanel(defaultDock, "preview", "sources", "center", bounds);
      const { panels } = layoutDock(swapped, bounds);
      expect(panels.preview.x).toBeGreaterThan(panels.sources.x);
   });

   it("moves a divider without pushing either neighbour below its minimum", () => {
      const root = defaultDock as Extract<DockNode, { split: "row" }>;
      const resolved = resolveSizes(root, bounds.width);
      const moved = resizeDock(root, { path: [], index: 0, sizes: resolved }, 5000);
      expect(layoutDock(moved, bounds).panels.sources.width).toBe(panelMinimum.sources.width);
   });

   it("points at a panel edge, its middle, or the layout's outer edge", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      const middle = dropTarget(panels, bounds, "actions", panels.preview.x + panels.preview.width / 2, panels.preview.y + panels.preview.height / 2);
      expect(middle).toMatchObject({ target: "preview", side: "center" });
      expect(dropTarget(panels, bounds, "actions", panels.preview.x + 40, 300)).toMatchObject({ target: "preview", side: "left" });
      expect(dropTarget(panels, bounds, "actions", 5, 300)).toMatchObject({ target: "root", side: "left" });
   });

   it("puts a panel in a corner of the layout", () => {
      const drop = planDrop(defaultDock, bounds, "mixer", bounds.width - 40, bounds.height - 10);
      const { panels } = layoutDock(drop!.next, bounds);
      expect(panels.mixer.x + panels.mixer.width).toBe(bounds.width);
      expect(panels.mixer.y + panels.mixer.height).toBe(bounds.height);
      expect(panels.mixer.width).toBeLessThan(bounds.width);
      expect(panels.mixer.height).toBeLessThan(bounds.height);
      expect(drop!.preview).toEqual(panels.mixer);
   });

   it("keeps a corner drop off a full edge when the corner panel spans the layout", () => {
      let layout: DockNode = {
         split: "column",
         sizes: [500, 150, 150, 150],
         children: [{ panel: "preview" }, { panel: "sources" }, { panel: "mixer" }, { panel: "actions" }],
      };
      layout = planDrop(layout, bounds, "sources", 10, bounds.height - 10)!.next;
      const { panels } = layoutDock(layout, bounds);
      expect(panels.sources).toMatchObject({ x: 0, y: bounds.height - panels.sources.height });
      expect(panels.sources.width).toBeLessThan(bounds.width);
   });

   it("ignores drops that leave the arrangement as it is", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      expect(planDrop(defaultDock, bounds, "mixer", panels.preview.x + 200, panels.preview.y + panels.preview.height - 10)).toBeNull();
   });

   it("gives drops with the same result one name", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      const corner = planDrop(defaultDock, bounds, "actions", 10, bounds.height - 10);
      const edge = planDrop(defaultDock, bounds, "actions", panels.mixer.x + 200, panels.mixer.y + panels.mixer.height - 40);
      expect(corner).toMatchObject({ target: "mixer", side: "bottom" });
      expect(edge).toMatchObject({ target: "mixer", side: "bottom" });
   });

   it("splits a crossing into four arms", () => {
      const segments = dividerSegments(layoutDock(defaultDock, bounds).dividers);
      expect(segments).toHaveLength(4);
      expect(segments.filter((segment) => segment.partial)).toHaveLength(2);
   });

   it("moves one arm of a crossing by joining the line across it", () => {
      const segments = dividerSegments(layoutDock(defaultDock, bounds).dividers);
      const upper = segments.find((segment) => segment.partial && segment.piece === 0)!;
      const { root, divider } = separateSegment(defaultDock, bounds, upper);
      const moved = layoutDock(resizeDock(root, divider, -100), bounds);
      const before = layoutDock(defaultDock, bounds).panels;
      expect(moved.panels.preview.width).toBe(before.preview.width - 100);
      expect(moved.panels.mixer.width).toBe(before.mixer.width);
      expect(moved.panels.sources.width).toBe(before.sources.width + 100);
      expect(moved.panels.mixer.y).toBe(moved.panels.actions.y);
      const across = moved.dividers.filter((item) => item.axis === "column");
      expect(across).toHaveLength(1);
      expect(across[0]!.rect.width).toBe(bounds.width);
   });

   it("joins arms into one line per direction, with one crossing where they meet", () => {
      const lines = dockLines(dividerSegments(layoutDock(defaultDock, bounds).dividers));
      expect(lines).toHaveLength(2);
      const flat = lines.find((line) => line.axis === "column")!;
      expect(flat.rect.width).toBe(bounds.width);
      expect(lineDividers(flat)).toHaveLength(2);
      expect(dockCrossings(lines)).toHaveLength(1);
   });

   it("moves a whole line by moving every divider on it", () => {
      const placed = layoutDock(defaultDock, bounds);
      const flat = dockLines(dividerSegments(placed.dividers)).find((line) => line.axis === "column")!;
      const moved = lineDividers(flat).reduce((node, divider) => resizeDock(node, divider, -60), defaultDock);
      const { panels } = layoutDock(moved, bounds);
      expect(panels.mixer.y).toBe(placed.panels.mixer.y - 60);
      expect(panels.actions.y).toBe(placed.panels.actions.y - 60);
   });

   it("squeezes every panel instead of overflowing when the minimums don't fit", () => {
      const tiny = { x: 0, y: 0, width: 400, height: 260 };
      const { panels } = layoutDock(defaultDock, tiny);
      for (const rect of Object.values(panels)) {
         expect(rect.x + rect.width).toBeLessThanOrEqual(tiny.width + 0.001);
         expect(rect.y + rect.height).toBeLessThanOrEqual(tiny.height + 0.001);
         expect(rect.width).toBeGreaterThan(0);
      }
   });

   it("finds the panel next to another for keyboard moves", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      expect(neighbourPanel(panels, "preview", "right")).toBe("sources");
      expect(neighbourPanel(panels, "preview", "bottom")).toBe("mixer");
      expect(neighbourPanel(panels, "actions", "left")).toBe("mixer");
      expect(neighbourPanel(panels, "preview", "left")).toBeNull();
   });

   it("starts from the side column and audio sizes the page had before docking", () => {
      const { panels } = layoutDock(dockFromSizes(300, 200), bounds);
      expect(panels.sources.width).toBe(300);
      expect(panels.mixer.height).toBe(200);
   });

   it("keeps panel minimums that are passed in", () => {
      const minimums = { ...panelMinimum, mixer: { width: 200, height: 400 } };
      expect(layoutDock(defaultDock, bounds, minimums).panels.mixer.height).toBe(400);
   });

   it("rejects stored layouts that lose or repeat a panel", () => {
      expect(isDockLayout(defaultDock)).toBe(true);
      expect(isDockLayout({ split: "row", sizes: [1, 1], children: [{ panel: "preview" }, { panel: "preview" }] })).toBe(false);
      expect(isDockLayout(null)).toBe(false);
   });
});
