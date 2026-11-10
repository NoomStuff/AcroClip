import type { Preferences } from "./types";

/**
 * Each action has a Banner choice and, when it makes a sound, a Sound choice.
 * Finding or losing a game or source can happen mid-game, so those never play one.
 */
export const notificationActions = {
   startRecording: { banner: "notificationStartBanner", sound: "notificationStartSound", defaultBanner: true },
   stopRecording: { banner: "notificationStopBanner", sound: "notificationStopSound", defaultBanner: true },
   saveClip: { banner: "notificationSaveBanner", sound: "notificationSaveSound", defaultBanner: true },
   gameFound: { banner: "notificationGameBanner", defaultBanner: true },
   gameLost: { banner: "notificationGameLostBanner", defaultBanner: false },
   capturePaused: { banner: "notificationPauseBanner", defaultBanner: true },
   error: { banner: "notificationErrorBanner", sound: "notificationErrorSound", defaultBanner: true },
} as const;

export type NotificationAction = keyof typeof notificationActions;
type ActionKeys<T> = T extends { banner: infer Banner; sound: infer Sound } ? Banner | Sound : T extends { banner: infer Banner } ? Banner : never;
export type NotificationPreferenceKey = ActionKeys<(typeof notificationActions)[NotificationAction]>;
export type NotificationEditableKey = Exclude<NotificationPreferenceKey, "notificationErrorBanner">;
export type NotificationPreferences = Pick<Preferences, NotificationPreferenceKey>;

export function notificationDelivery(preferences: NotificationPreferences, action: NotificationAction): { banner: boolean; sound: boolean } {
   const keys: { banner: NotificationPreferenceKey; sound?: NotificationPreferenceKey } = notificationActions[action];
   return { banner: action === "error" || preferences[keys.banner], sound: keys.sound ? preferences[keys.sound] : false };
}

/** Retire the global switches without resetting any unrelated preferences. */
export function migrateNotificationPreferences(value: unknown): Record<string, unknown> {
   const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
   const legacyBanner = stored["notifications"] !== "off";
   const legacySound = typeof stored["sound"] === "boolean" ? stored["sound"] : true;
   for (const [action, keys] of Object.entries(notificationActions) as Array<[NotificationAction, (typeof notificationActions)[NotificationAction]]>) {
      // A banner that starts off stays off, whatever the old global switch said.
      if (!(keys.banner in stored)) stored[keys.banner] = action === "error" || (keys.defaultBanner && legacyBanner);
      if ("sound" in keys && !(keys.sound in stored)) stored[keys.sound] = legacySound;
   }
   delete stored["notifications"];
   delete stored["sound"];
   stored["notificationErrorBanner"] = true;
   return stored;
}
