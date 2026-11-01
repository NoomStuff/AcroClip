import { describe, expect, it } from "vitest";
import { isWaylandSession } from "./linux-session";

describe("Linux capture session detection", () => {
   it("recognizes sessions advertised without a Wayland socket name", () => {
      expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" }, "linux")).toBe(true);
      expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-1", XDG_SESSION_TYPE: "x11" }, "linux")).toBe(true);
   });
   it("keeps X11 and other platforms out of the portal path", () => {
      expect(isWaylandSession({ WAYLAND_DISPLAY: "", XDG_SESSION_TYPE: "x11" }, "linux")).toBe(false);
      expect(isWaylandSession({}, "linux")).toBe(false);
      expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-0" }, "win32")).toBe(false);
      expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" }, "darwin")).toBe(false);
   });
});
