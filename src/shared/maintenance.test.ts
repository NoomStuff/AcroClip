import { describe, expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { factoryResetDetail, recordingSetupKeys, resetPreferenceGroups } from "./maintenance";
import { preferenceResetSchema } from "./validation";
import type { Preferences } from "./types";

const customized: Preferences = {
   ...defaultPreferences,
   collection: "/clips",
   setupComplete: true,
   clipSeconds: 45,
   sourceKind: "app",
   sourceId: "game",
   shareSizeMB: 8,
   notificationStopSound: false,
   filenameTemplate: "{date} {source}",
};

describe("resetPreferenceGroups", () => {
   it("resets plain settings and leaves the recording setup", () => {
      const next = resetPreferenceGroups(customized, { settings: true, setup: false });
      expect(next).toMatchObject({ shareSizeMB: 20, notificationStopSound: true, filenameTemplate: defaultPreferences.filenameTemplate });
      expect(next).toMatchObject({ clipSeconds: 45, sourceKind: "app", sourceId: "game", collection: "/clips", setupComplete: true });
   });

   it("resets the recording setup and opens setup, leaving plain settings", () => {
      const next = resetPreferenceGroups(customized, { settings: false, setup: true });
      expect(next).toMatchObject({ clipSeconds: 60, sourceKind: "screen", sourceId: "", setupComplete: false, collection: "/clips" });
      expect(next).toMatchObject({ shareSizeMB: 8, notificationStopSound: false });
   });

   it("resets everything but the collection when both are chosen", () => {
      expect(resetPreferenceGroups(customized, { settings: true, setup: true })).toEqual({ ...defaultPreferences, collection: "/clips" });
   });

   it("never shares the default audio sources with the result", () => {
      const next = resetPreferenceGroups(customized, { settings: false, setup: true });
      expect(next.audioSources).toEqual(defaultPreferences.audioSources);
      expect(next.audioSources).not.toBe(defaultPreferences.audioSources);
   });

   it("only names real preferences as recording setup", () => {
      for (const key of recordingSetupKeys) expect(defaultPreferences).toHaveProperty(key);
   });

   it("needs at least one group", () => {
      expect(preferenceResetSchema.safeParse({ settings: false, setup: false }).success).toBe(false);
   });
});

describe("factoryResetDetail", () => {
   it("lists the parts and only mentions setup when settings go", () => {
      expect(factoryResetDetail(["cache"])).toBe(
         "This removes cache. AcroClip restarts. Your clips, tags and shareables stay where they are. This can't be undone."
      );
      expect(factoryResetDetail(["settings", "logs", "stats"])).toContain(
         "removes settings and recording setup, logs and usage stats. AcroClip restarts and opens setup."
      );
   });
});
