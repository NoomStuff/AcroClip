import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPreferences, stoppedRecorder } from "../../shared/defaults";
import type { AppState } from "../../shared/types";
vi.stubGlobal("window", { acroClip: {} });
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
               openGames: vi.fn(),
            })
         );
         expect(html).not.toContain("mixer-monitor-error");
         const status = renderToStaticMarkup(
            createElement(RecordingStatus, { state: { ...state, recorder: { ...state.recorder, state: "waiting", message } }, elapsed: 0 })
         );
         expect(status).toContain(message || "Waiting for application");
         expect(html).not.toContain("Recording audio");
      }
      const html = renderToStaticMarkup(
         createElement(Recording, {
            state: { ...state, recorder: { ...state.recorder, state: "recording" } },
            visible: false,
            run: async () => true,
            pulse: 0,
            openGames: vi.fn(),
         })
      );
      expect(html).not.toContain("Waiting for capture");
      expect(html).toContain('aria-label="Source audio peak"');
   });
   it("keeps the microphone as an ordinary editable row with no permanent device selector", () => {
      const html = renderToStaticMarkup(createElement(Recording, { state, visible: false, run: vi.fn(), pulse: 0, openGames: vi.fn() }));
      expect(html).toContain('aria-label="Microphone options"');
      expect(html).not.toContain('aria-label="Microphone device"');
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
