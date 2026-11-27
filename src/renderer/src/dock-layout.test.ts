import { describe, expect, it } from "vitest";
import { defaultDock, dockPanel, dropTarget, groupDividers, isDockLayout, layoutDock, panelMinimum, planDrop, resizeDock, resolveSizes } from "./dock-layout";
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

   it("joins dividers that line up into one", () => {
      const groups = groupDividers(layoutDock(defaultDock, bounds).dividers);
      const across = groups.find((group) => group.axis === "column")!;
      expect(groups).toHaveLength(2);
      expect(across.members).toHaveLength(2);
      expect(across.rect.width).toBe(bounds.width);
   });

   it("rejects stored layouts that lose or repeat a panel", () => {
      expect(isDockLayout(defaultDock)).toBe(true);
      expect(isDockLayout({ split: "row", sizes: [1, 1], children: [{ panel: "preview" }, { panel: "preview" }] })).toBe(false);
      expect(isDockLayout(null)).toBe(false);
   });
});
