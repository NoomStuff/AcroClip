import { expect, it } from "vitest";
import { menuPosition, submenuPosition } from "./menu-position";

it("anchors right-click animation to the click instead of the three-dot trigger", () => {
   const result = menuPosition(
      { left: 800, right: 830, top: 30, bottom: 60 },
      { width: 200, height: 160 },
      { width: 1000, height: 800 },
      { left: 100, top: 120 }
   );
   expect(result).toEqual({ left: 100, top: 120, transformOrigin: "0px 0px" });
});
it("keeps a clamped context menu's animation pivot at the actual click", () => {
   const result = menuPosition(
      { left: 10, right: 40, top: 10, bottom: 40 },
      { width: 200, height: 160 },
      { width: 1000, height: 800 },
      { left: 990, top: 790 }
   );
   expect(result).toEqual({ left: 792, top: 632, transformOrigin: "198px 158px" });
});
it("uses the trigger side when a button menu opens below or above it", () => {
   const size = { width: 200, height: 160 },
      viewport = { width: 1000, height: 800 };
   expect(menuPosition({ left: 800, right: 830, top: 30, bottom: 60 }, size, viewport).transformOrigin).toBe("200px 0px");
   expect(menuPosition({ left: 800, right: 830, top: 750, bottom: 780 }, size, viewport).transformOrigin).toBe("200px 160px");
});
it("opens submenus beside their trigger and flips them at the right edge", () => {
   const size = { width: 200, height: 180 },
      viewport = { width: 1000, height: 800 };
   expect(submenuPosition({ left: 100, right: 300, top: 200, bottom: 236 }, size, viewport)).toEqual({ left: 304, top: 200, transformOrigin: "0px 18px" });
   expect(submenuPosition({ left: 800, right: 990, top: 700, bottom: 736 }, size, viewport)).toEqual({ left: 596, top: 612, transformOrigin: "200px 106px" });
});
