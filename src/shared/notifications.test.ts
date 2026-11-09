import { expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { migrateNotificationPreferences, notificationActions, notificationDelivery } from "./notifications";
import { preferencesSchema } from "./validation";

it.each(Object.keys(notificationActions) as Array<keyof typeof notificationActions>)("keeps %s banner and sound choices independent", (action) => {
   const keys = notificationActions[action];
   const soundOnly = { ...defaultPreferences, [keys.banner]: false, [keys.sound]: true };
   expect(notificationDelivery(soundOnly, action)).toEqual({ banner: action === "error", sound: true });
   const bannerOnly = { ...defaultPreferences, [keys.banner]: true, [keys.sound]: false };
   expect(notificationDelivery(bannerOnly, action)).toEqual({ banner: true, sound: false });
});
it("does not let a disabled save notification suppress error banners", () => {
   const preferences = { ...defaultPreferences, notificationSaveBanner: false, notificationSaveSound: false, notificationErrorSound: false };
   expect(notificationDelivery(preferences, "saveClip")).toEqual({ banner: false, sound: false });
   expect(notificationDelivery(preferences, "error")).toEqual({ banner: true, sound: false });
});
it("rejects attempts to disable error banners at the settings boundary", () => {
   expect(preferencesSchema.safeParse({ ...defaultPreferences, collection: "clips", notificationErrorBanner: false }).success).toBe(false);
});
it("migrates old global mute settings and removes the retired fields", () => {
   const migrated = migrateNotificationPreferences({ notifications: "off", sound: false, clipSeconds: 90 });
   const parsed = preferencesSchema.parse({ ...defaultPreferences, collection: "clips", ...migrated });
   for (const action of ["startRecording", "stopRecording", "saveClip"] as const)
      expect(notificationDelivery(parsed, action)).toEqual({ banner: false, sound: false });
   expect(notificationDelivery(parsed, "error")).toEqual({ banner: true, sound: false });
   expect(parsed.clipSeconds).toBe(90);
   expect(migrated).not.toHaveProperty("notifications");
   expect(migrated).not.toHaveProperty("sound");
});
it("retains new individual choices and repairs a manually disabled error banner on disk", () => {
   const migrated = migrateNotificationPreferences({
      notificationStartBanner: false,
      notificationStartSound: true,
      notificationErrorBanner: false,
      notificationErrorSound: false,
   });
   const parsed = preferencesSchema.parse({ ...defaultPreferences, collection: "clips", ...migrated });
   expect(notificationDelivery(parsed, "startRecording")).toEqual({ banner: false, sound: true });
   expect(notificationDelivery(parsed, "error")).toEqual({ banner: true, sound: false });
});
