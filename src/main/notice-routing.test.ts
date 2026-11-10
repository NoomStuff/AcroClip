import { describe, expect, it } from "vitest";
import { defaultPreferences } from "../shared/defaults";
import { captureErrorReport, feedbackRequest, feedbackSoundFiles, routeNotice, type NoticeKind } from "./notice-routing";

const context = { preferences: defaultPreferences, focused: false };

describe("notice surfaces", () => {
   it("keeps progress and successes on the banner without an in-app copy", () => {
      for (const kind of [
         "saving",
         "saved",
         "save-note",
         "recording-starting",
         "recording-progress",
         "recording-source",
         "recording-paused",
         "recording-resumed",
         "recording-started",
         "recording-stopped",
      ] as const)
         for (const surface of ["background", "native"] as const)
            expect(routeNotice("Status", false, kind, surface, {}, { ...context, focused: true })).toEqual({ app: null, feedback: true });
   });

   it("puts background errors on the banner and leaves a quiet chip, focused or not", () => {
      for (const focused of [false, true])
         expect(routeNotice("Capture stopped unexpectedly", true, "critical-error", "background", { key: "capture" }, { ...context, focused })).toEqual({
            app: { message: "Capture stopped unexpectedly", error: true, chip: true, key: "capture", toast: false },
            feedback: true,
         });
   });

   it("answers in-window actions in the app only", () => {
      expect(routeNotice("Couldn't rename the clip", true, "info", "action", {}, context)).toEqual({
         app: { message: "Couldn't rename the clip", error: true, chip: true },
         feedback: false,
      });
   });

   it("toasts app notices only while the window has focus", () => {
      expect(routeNotice("Extended", false, "info", "app", {}, context).app).toMatchObject({ toast: false });
      expect(routeNotice("Extended", false, "info", "app", {}, { ...context, focused: true }).app).toMatchObject({ toast: true });
   });

   it("keeps a native warning out of the app, which shows it as a condition", () => {
      expect(routeNotice("Low storage", false, "info", "native", { tone: "warning" }, context)).toEqual({ app: null, feedback: true });
   });
});

describe("banner requests", () => {
   const preferences = {
      ...defaultPreferences,
      notificationStartSound: false,
      notificationSaveBanner: false,
      notificationStopBanner: false,
      notificationStopSound: false,
   };

   it("follows each action's Banner and Sound choice", () => {
      expect(feedbackRequest(false, "saving", {}, preferences, null)).toMatchObject({ visual: false, preserveBanner: true, sound: "clip-load.wav" });
      expect(feedbackRequest(false, "recording-stopped", {}, preferences, null)).toMatchObject({ visual: false, preserveBanner: true });
      expect(feedbackRequest(false, "recording-stopped", {}, preferences, null)).not.toHaveProperty("sound");
      expect(feedbackRequest(false, "recording-starting", {}, preferences, null)).toMatchObject({ visual: true, busy: true, replay: true });
      expect(feedbackRequest(false, "recording-starting", {}, preferences, null)).not.toHaveProperty("sound");
   });

   it("closes its own banner when that action is muted mid-sequence, and leaves an unrelated error banner up", () => {
      const muted = { ...preferences, notificationStartBanner: false };
      expect(feedbackRequest(false, "recording-progress", {}, muted, "startRecording")).toMatchObject({ visual: false, preserveBanner: false });
      expect(feedbackRequest(false, "recording-progress", {}, muted, "error")).toMatchObject({ visual: false, preserveBanner: true });
   });

   it("always shows error banners, which play the error sound unless it is off", () => {
      expect(feedbackRequest(true, "critical-error", {}, preferences, null)).toMatchObject({ action: "error", visual: true, sound: "critical-error.wav" });
      expect(feedbackRequest(true, "info", {}, preferences, null)).toMatchObject({ visual: true, sound: "critical-error.wav" });
      expect(feedbackRequest(true, "critical-error", {}, { ...preferences, notificationErrorSound: false }, null)).not.toHaveProperty("sound");
   });

   it("shows warnings on the error banner without its sound", () => {
      const request = feedbackRequest(false, "info", { tone: "warning" }, defaultPreferences, null);
      expect(request).toMatchObject({ action: "error", visual: true });
      expect(request).not.toHaveProperty("sound");
   });

   it("corrects an announced save on the save banner without a second chime", () => {
      const note = feedbackRequest(false, "save-note", {}, defaultPreferences, "saveClip");
      expect(note).toMatchObject({ action: "saveClip", visual: true, completed: false });
      expect(note).not.toHaveProperty("sound");
      expect(feedbackRequest(false, "save-note", {}, preferences, "saveClip")).toMatchObject({ visual: false, preserveBanner: false });
   });

   it("marks only real completions for the thumbnail rebound and only confirmed starts for the pulse", () => {
      const flags = (kind: NoticeKind) => feedbackRequest(false, kind, {}, defaultPreferences, null);
      expect(flags("saved")).toMatchObject({ completed: true, pulse: false });
      expect(flags("recording-started")).toMatchObject({ completed: false, pulse: true, busy: false });
      expect(flags("recording-progress")).toMatchObject({ busy: true, replay: false, pulse: false });
      for (const kind of ["recording-source", "recording-paused", "recording-resumed"] as const) {
         expect(flags(kind)).toMatchObject({ busy: false, pulse: false });
         expect(flags(kind)).not.toHaveProperty("sound");
      }
   });

   it("shows new and returning sources under Now capturing, and pauses under their own banner", () => {
      for (const kind of ["recording-source", "recording-resumed"] as const)
         expect(feedbackRequest(false, kind, {}, defaultPreferences, null)).toMatchObject({ action: "captureSource", visual: true });
      expect(feedbackRequest(false, "recording-paused", {}, defaultPreferences, null)).toMatchObject({ action: "capturePaused", visual: false });
      expect(feedbackRequest(false, "recording-paused", {}, { ...defaultPreferences, notificationPauseBanner: true }, null)).toMatchObject({ visual: true });
      expect(feedbackRequest(false, "recording-resumed", {}, { ...defaultPreferences, notificationSourceBanner: false }, null)).toMatchObject({
         visual: false,
      });
   });

   it("names six distinct sounds", () => {
      expect(feedbackSoundFiles).toEqual(["clip-load.wav", "clip-success.wav", "capture-load.wav", "capture-on.wav", "capture-off.wav", "critical-error.wav"]);
   });
});

describe("capture action errors", () => {
   const healthy = { handled: false, errored: false, reported: false };

   it("reports failed saves once on the banner", () => {
      expect(captureErrorReport("The drive is full", { save: true, timedOut: false }, healthy)).toEqual({
         type: "critical",
         title: "Couldn't save clip",
         detail: "The drive is full",
         key: "save",
      });
   });

   it("does not claim a timed-out save failed, because it may still land", () => {
      expect(captureErrorReport("Capture didn't respond in time.", { save: true, timedOut: true }, healthy)).toEqual({
         type: "critical",
         title: "Capture didn't respond in time",
         detail: "",
         key: "save",
      });
   });

   it("only logs a save that failed because of a crash already on the banner", () => {
      expect(captureErrorReport("The helper exited", { save: true, timedOut: false }, { handled: false, errored: true, reported: true })).toEqual({
         type: "log",
      });
      expect(captureErrorReport("Capture stopped unexpectedly.", { save: true, timedOut: false }, { ...healthy, handled: true })).toEqual({ type: "ignore" });
   });

   it("shows other refusals as an ordinary error", () => {
      expect(captureErrorReport("Start capturing before saving a clip.", { save: false, timedOut: false }, healthy)).toEqual({ type: "notice" });
   });
});
