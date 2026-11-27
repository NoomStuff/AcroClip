import { describe, expect, it } from "vitest";
import { defaultDock, dockPanel, dropTarget, isDockLayout, layoutDock, panelMinimum, resizeDock, resolveSizes } from "./dock-layout";
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
      const moved = resizeDock(root, { path: [], index: 0 }, resolved, 5000);
      expect(layoutDock(moved, bounds).panels.sources.width).toBe(panelMinimum.sources.width);
   });

   it("points at a panel edge, its middle, or the layout's outer edge", () => {
      const { panels } = layoutDock(defaultDock, bounds);
      const middle = dropTarget(panels, bounds, "actions", panels.preview.x + panels.preview.width / 2, panels.preview.y + panels.preview.height / 2);
      expect(middle).toMatchObject({ target: "preview", side: "center" });
      expect(dropTarget(panels, bounds, "actions", panels.preview.x + 40, 300)).toMatchObject({ target: "preview", side: "left" });
      expect(dropTarget(panels, bounds, "actions", 5, 300)).toMatchObject({ target: "root", side: "left" });
   });

   it("rejects stored layouts that lose or repeat a panel", () => {
      expect(isDockLayout(defaultDock)).toBe(true);
      expect(isDockLayout({ split: "row", sizes: [1, 1], children: [{ panel: "preview" }, { panel: "preview" }] })).toBe(false);
      expect(isDockLayout(null)).toBe(false);
   });
});
