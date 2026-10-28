import { expect, it } from "vitest";
import { electronSourcePins, hasPinnedElectronSources } from "./electron-source-evidence";

it("reuses published source inputs only when every reviewed Electron dependency pin matches", () => {
   expect(hasPinnedElectronSources({ ...electronSourcePins, platform: "win32" })).toBe(true);
   for (const key of Object.keys(electronSourcePins)) {
      expect(hasPinnedElectronSources({ ...electronSourcePins, [key]: "changed" })).toBe(false);
      const missing: Record<string, unknown> = { ...electronSourcePins };
      delete missing[key];
      expect(hasPinnedElectronSources(missing)).toBe(false);
   }
   for (const invalid of [null, [], "source", {}]) expect(hasPinnedElectronSources(invalid)).toBe(false);
});
