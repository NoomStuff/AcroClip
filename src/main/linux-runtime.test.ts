import { describe, expect, it } from "vitest";
import { linuxRecorderEnvironment } from "./linux-runtime";

describe("Linux graphics driver runtime", () => {
   it("uses host driver dependencies while retaining bundled recorder libraries and user overrides", () => {
      const files = new Set(["/usr/lib/libwayland-client.so.0", "/usr/lib/libva.so.2", "/usr/lib/libstdc++.so.6"]);
      const env = linuxRecorderEnvironment(
         "/app/recorder",
         { LD_LIBRARY_PATH: "/custom/lib", LD_PRELOAD: "/custom/override.so", LIBVA_DRIVER_NAME: "custom" },
         "x64",
         (file) => files.has(file)
      );
      expect(env["LD_PRELOAD"]).toBe("/custom/override.so:/usr/lib/libstdc++.so.6:/usr/lib/libwayland-client.so.0:/usr/lib/libva.so.2");
      expect(env["LD_LIBRARY_PATH"]).toBe("/app/recorder/lib:/custom/lib");
      expect(env["LIBVA_DRIVER_NAME"]).toBe("custom");
   });
   it("uses the ARM system libraries and leaves absent optional libraries bundled", () => {
      const env = linuxRecorderEnvironment("/app", {}, "arm64", (file) => file === "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0");
      expect(env["LD_PRELOAD"]).toBe("/usr/lib/aarch64-linux-gnu/libwayland-client.so.0");
      expect(linuxRecorderEnvironment("/app", {}, "x64", () => false)["LD_PRELOAD"]).toBeUndefined();
   });
});
