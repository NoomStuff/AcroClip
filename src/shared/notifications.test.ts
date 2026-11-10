import { expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { migrateNotificationPreferences, notificationActions, notificationDelivery } from "./notifications";
import type { NotificationAction, NotificationPreferenceKey } from "./notifications";
import { preferencesSchema } from "./validation";

const actions = Object.keys(notificationActions) as NotificationAction[];
it.each(actions)("keeps %s banner and sound choices independent", (action) => {
   const keys: { banner: NotificationPreferenceKey; sound?: NotificationPreferenceKey } = notificationActions[action];
   const sound = keys.sound;
   if (!sound) {
      expect(notificationDelivery({ ...defaultPreferences, [keys.banner]: true }, action)).toEqual({ banner: true, sound: false });
      expect(notificationDelivery({ ...defaultPreferences, [keys.banner]: false }, action)).toEqual({ banner: false, sound: false });
      return;
   }
   const soundOnly = { ...defaultPreferences, [keys.banner]: false, [sound]: true };
   expect(notificationDelivery(soundOnly, action)).toEqual({ banner: action === "error", sound: true });
   const bannerOnly = { ...defaultPreferences, [keys.banner]: true, [sound]: false };
   expect(notificationDelivery(bannerOnly, action)).toEqual({ banner: true, sound: false });
});
it("never plays a sound for finding or losing a source, and starts with only the game-lost banner off", () => {
   for (const action of ["gameFound", "gameLost", "capturePaused", "captureResumed"] as const)
      expect(notificationDelivery(defaultPreferences, action).sound).toBe(false);
   expect(notificationDelivery(defaultPreferences, "gameFound").banner).toBe(true);
   expect(notificationDelivery(defaultPreferences, "gameLost").banner).toBe(false);
   expect(notificationDelivery(defaultPreferences, "capturePaused").banner).toBe(true);
   expect(notificationDelivery(defaultPreferences, "captureResumed").banner).toBe(true);
});
it("adds the new banners to existing settings with their own defaults", () => {
   const parsed = preferencesSchema.parse({ ...defaultPreferences, collection: "clips", ...migrateNotificationPreferences({ notificationStartBanner: true }) });
   expect(parsed).toMatchObject({
      notificationGameBanner: true,
      notificationGameLostBanner: false,
      notificationPauseBanner: true,
      notificationResumeBanner: true,
   });
   const muted = preferencesSchema.parse({ ...defaultPreferences, collection: "clips", ...migrateNotificationPreferences({ notifications: "off" }) });
   expect(muted).toMatchObject({
      notificationGameBanner: false,
      notificationGameLostBanner: false,
      notificationPauseBanner: false,
      notificationResumeBanner: false,
   });
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
