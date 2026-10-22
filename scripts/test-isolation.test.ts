import { describe, expect, it } from "vitest";
import { hostedTestIsolation, privateLinuxTestIsolation } from "./test-isolation";

describe("interactive test isolation", () => {
   it("rejects an ordinary desktop and a broad CI flag", () => {
      expect(hostedTestIsolation({}, "win32")).toBe(false);
      expect(hostedTestIsolation({ CI: "true" }, "win32")).toBe(false);
      expect(hostedTestIsolation({ GITHUB_ACTIONS: "true" }, "win32")).toBe(false);
   });
   it("requires the private Windows endpoint readiness result", () => {
      const runner = { GITHUB_ACTIONS: "true", ACROCLIP_ISOLATED_TEST_RUNNER: "github-hosted" };
      expect(hostedTestIsolation(runner, "win32")).toBe(false);
      expect(hostedTestIsolation({ ...runner, ACROCLIP_TEST_RENDER_ENDPOINT_ID: "fixture-endpoint" }, "win32")).toBe(true);
      expect(hostedTestIsolation(runner, "darwin")).toBe(true);
   });
   it("rejects a Linux desktop or physical PulseAudio server disguised by flags", () => {
      expect(
         privateLinuxTestIsolation({
            ACROCLIP_ISOLATED_TEST_RUNNER: "private-linux",
            DISPLAY: ":0",
            XDG_RUNTIME_DIR: "/run/user/1000",
            PULSE_SERVER: "unix:/run/user/1000/pulse/native",
         })
      ).toBe(false);
   });
});
