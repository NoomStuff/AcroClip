import type { Preferences } from "./types";

export const notificationActions = {
   startRecording: { banner: "notificationStartBanner", sound: "notificationStartSound" },
   stopRecording: { banner: "notificationStopBanner", sound: "notificationStopSound" },
   saveClip: { banner: "notificationSaveBanner", sound: "notificationSaveSound" },
   error: { banner: "notificationErrorBanner", sound: "notificationErrorSound" },
} as const;

export type NotificationAction = keyof typeof notificationActions;
export type NotificationPreferenceKey = (typeof notificationActions)[NotificationAction]["banner" | "sound"];
export type NotificationEditableKey = Exclude<NotificationPreferenceKey, "notificationErrorBanner">;
export type NotificationPreferences = Pick<Preferences, NotificationPreferenceKey>;

export function notificationDelivery(preferences: NotificationPreferences, action: NotificationAction): { banner: boolean; sound: boolean } {
   const keys = notificationActions[action];
   return { banner: action === "error" || preferences[keys.banner], sound: preferences[keys.sound] };
}

/** Retire the global switches without resetting any unrelated preferences. */
export function migrateNotificationPreferences(value: unknown): Record<string, unknown> {
   const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
   const legacyBanner = stored["notifications"] !== "off";
   const legacySound = typeof stored["sound"] === "boolean" ? stored["sound"] : true;
   for (const [action, keys] of Object.entries(notificationActions)) {
      if (!(keys.banner in stored)) stored[keys.banner] = action === "error" || legacyBanner;
      if (!(keys.sound in stored)) stored[keys.sound] = legacySound;
   }
   delete stored["notifications"];
   delete stored["sound"];
   stored["notificationErrorBanner"] = true;
   return stored;
}
