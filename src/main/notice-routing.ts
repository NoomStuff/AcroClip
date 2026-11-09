import { notificationDelivery, type NotificationAction, type NotificationPreferences } from "../shared/notifications";
import type { NoticeOptions } from "../shared/types";
import type { RecordingNoticeKind } from "./recording-notices";

/**
 * Where a notice goes.
 * - `action`: answers something done in the window. In-app toast, no banner.
 * - `background`: happens while the user may be in a game. Desktop banner;
 *   errors and warnings also wait in the app as a quiet chip, and toast there
 *   instead when banners are off.
 * - `native`: desktop banner only, like clip saving.
 * - `app`: in-app only, toasting while the window has focus.
 */
export type NoticeSurface = "action" | "background" | "native" | "app";
/** `save-note` corrects a save already announced, such as an extension that kept both clips. */
export type NoticeKind = "info" | "saving" | "saved" | "save-note" | RecordingNoticeKind;

const notificationAction: Record<NoticeKind, NotificationAction> = {
   info: "error",
   saving: "saveClip",
   saved: "saveClip",
   "save-note": "saveClip",
   "recording-starting": "startRecording",
   "recording-progress": "startRecording",
   "recording-started": "startRecording",
   "recording-source": "captureSource",
   // Coming back after a pause the user was told about. Without that banner, an alt-tab would announce every return.
   "recording-paused": "capturePaused",
   "recording-resumed": "capturePaused",
   "recording-stopped": "stopRecording",
   "critical-error": "error",
};
const feedbackSounds: Partial<Record<NoticeKind, string>> = {
   saving: "clip-load.wav",
   saved: "clip-success.wav",
   "recording-starting": "capture-load.wav",
   "recording-started": "capture-on.wav",
   "recording-stopped": "capture-off.wav",
   "critical-error": "critical-error.wav",
};
/** Every shipped feedback sound, for packaging checks. */
export const feedbackSoundFiles: readonly string[] = [...new Set(Object.values(feedbackSounds))];

/** Warnings borrow the error banner, which cannot be turned off, but never its sound. */
export function noticeAction(error: boolean, kind: NoticeKind, options: NoticeOptions): NotificationAction {
   return error || options.tone === "warning" ? "error" : notificationAction[kind];
}

export interface NoticeRoute {
   /** What the renderer receives, if anything. */
   app: ({ message: string; error: boolean } & NoticeOptions) | null;
   /** Whether the notice reaches the banner helper, which also plays its sound. */
   feedback: boolean;
}

export function routeNotice(
   message: string,
   error: boolean,
   kind: NoticeKind,
   surface: NoticeSurface,
   options: NoticeOptions,
   context: { preferences: NotificationPreferences; focused: boolean }
): NoticeRoute {
   const feedback = surface === "background" || surface === "native";
   const banner = feedback && notificationDelivery(context.preferences, noticeAction(error, kind, options)).banner;
   const serious = error || options.tone === "warning";
   if (surface === "action") return { app: { message, error, chip: error, ...options }, feedback };
   if (surface === "app" || (surface === "background" && serious))
      return { app: { message, error, chip: serious, ...options, toast: surface === "app" ? context.focused : !banner }, feedback };
   return { app: null, feedback };
}

export interface FeedbackRequest {
   action: NotificationAction;
   /** The banner shows this notice. */
   visual: boolean;
   /** A hidden notice leaves a banner from another action on screen. */
   preserveBanner: boolean;
   /** File name in resources/feedback. */
   sound?: string;
   busy: boolean;
   completed: boolean;
   replay: boolean;
   pulse: boolean;
}

/** How the banner helper presents a notice, given the action whose banner is on screen. */
export function feedbackRequest(
   error: boolean,
   kind: NoticeKind,
   options: NoticeOptions,
   preferences: NotificationPreferences,
   visibleAction: NotificationAction | null
): FeedbackRequest {
   const action = noticeAction(error, kind, options);
   const delivery = notificationDelivery(preferences, action);
   const file = options.tone === "warning" ? undefined : (feedbackSounds[kind] ?? (error ? feedbackSounds["critical-error"] : undefined));
   return {
      action,
      visual: delivery.banner,
      preserveBanner: !delivery.banner && visibleAction !== action,
      ...(delivery.sound && file ? { sound: file } : {}),
      busy: kind === "saving" || kind === "recording-starting" || kind === "recording-progress",
      completed: kind === "saved",
      replay: kind === "saving" || kind === "recording-starting",
      pulse: kind === "recording-started",
   };
}

export type CaptureErrorReport =
   { type: "ignore" } | { type: "log" } | { type: "critical"; title: string; detail: string; key: "capture" | "save" } | { type: "notice" };

/**
 * A failed capture action. A crash already on the banner is not repeated, and
 * a save that timed out may still land, so it states that without inviting a duplicate.
 */
export function captureErrorReport(
   message: string,
   failure: { save: boolean; timedOut: boolean },
   recorder: { handled: boolean; errored: boolean; reported: boolean }
): CaptureErrorReport {
   if (recorder.handled) return { type: "ignore" };
   if (!failure.save) return { type: "notice" };
   if (recorder.errored && recorder.reported) return { type: "log" };
   if (failure.timedOut) return { type: "critical", title: "Capture didn't respond in time", detail: "", key: "save" };
   return { type: "critical", title: "Couldn't save clip", detail: message, key: "save" };
}
