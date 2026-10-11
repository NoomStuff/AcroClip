import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPreferences, stoppedRecorder } from "../../shared/defaults";
import type { AppState } from "../../shared/types";
vi.stubGlobal("window", { attaClip: {} });
const { Recording } = await import("./Recording");
const { RecordingStatus } = await import("./App");
afterAll(() => vi.unstubAllGlobals());
const state: AppState = {
   windowVisible: true,
   preferences: { ...defaultPreferences, setupComplete: true, microphone: true, microphoneDevice: "missing-raw-device" },
   clips: [],
   categories: [],
   jobs: [],
   recorder: { ...stoppedRecorder, supported: true },
   update: { state: "idle", version: "", progress: 0, message: "" },
   version: "0.2.0",
   platform: "win32",
};
describe("persistent recording feedback", () => {
   it("shows the actual waiting reason instead of claiming audio is recording", () => {
      for (const message of ["Microphone: selected device is unavailable", ""]) {
         const html = renderToStaticMarkup(
            createElement(Recording, {
               state: { ...state, recorder: { ...state.recorder, state: "waiting", message } },
               visible: false,
               run: async () => true,
               pulse: 0,
            })
         );
         expect(html).toContain(message || "Waiting for capture");
         expect(html).not.toContain("Recording audio");
      }
      const html = renderToStaticMarkup(
         createElement(Recording, {
            state: { ...state, recorder: { ...state.recorder, state: "recording" } },
            visible: false,
            run: async () => true,
            pulse: 0,
         })
      );
      expect(html).toContain("Recording audio");
   });
   it("shows the unavailable selected microphone instead of suggesting default", () => {
      const html = renderToStaticMarkup(createElement(Recording, { state, visible: false, run: async () => true, pulse: 0 }));
      expect(html).toContain('value="missing-raw-device" selected="">Selected device unavailable');
      expect(html).not.toContain('value="default" selected=""');
   });
   it("keeps the actual recording indicator, timing and pending saves beside low storage", () => {
      const html = renderToStaticMarkup(
         createElement(RecordingStatus, {
            state: {
               ...state,
               storageWarning: "Low storage in clip folder",
               recorder: { ...state.recorder, state: "recording", startedAt: 100, availableSeconds: 60, pendingSaves: 2 },
            },
            elapsed: 125,
         })
      );
      expect(html).toContain("status-dot recording");
      expect(html).toContain(">Recording<");
      expect(html).toContain(">2:05<");
      expect(html).toContain("60s available");
      expect(html).toContain("Low storage in clip folder");
      expect(html).toContain("Saving 2 clips");
      expect(html).not.toContain("has-error");
   });
   it("retains the actual failure and waiting reasons independently of storage", () => {
      for (const status of ["error", "waiting"] as const) {
         const html = renderToStaticMarkup(
            createElement(RecordingStatus, {
               state: {
                  ...state,
                  storageWarning: "Low storage in clip folder",
                  recorder: { ...state.recorder, state: status, message: "Selected microphone is unavailable" },
               },
               elapsed: 0,
            })
         );
         expect(html).toContain("Selected microphone is unavailable");
         expect(html).toContain("Low storage in clip folder");
         expect(html).not.toContain("status-dot recording");
      }
   });
});
