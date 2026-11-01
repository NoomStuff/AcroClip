import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { DragEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPreferences, stoppedRecorder } from "../../shared/defaults";
import type { AppState } from "../../shared/types";
vi.stubGlobal("window", { acroClip: {} });
const { RecordingStatus } = await import("./RecordingStatus");
afterAll(() => vi.unstubAllGlobals());
const state: AppState = {
   windowVisible: true,
   preferences: { ...defaultPreferences, setupComplete: true, microphone: true, microphoneDevice: "missing-raw-device" },
   collectionStatus: { root: "", phase: "ready" },
   folders: [],
   applicationIcons: {},
   clips: [],
   categories: [],
   jobs: [],
   recorder: { ...stoppedRecorder, supported: true },
   update: { state: "idle", version: "", progress: 0, message: "" },
   version: "0.2.0",
   platform: "win32",
};
describe("recording buffer status", () => {
   it("shows available footage and the fraction of the requested buffer", () => {
      const html = renderToStaticMarkup(
         createElement(RecordingStatus, { state: { ...state, recorder: { ...state.recorder, state: "recording", availableSeconds: 42 } }, visible: true })
      );
      expect(html).toContain("0:42 available");
      expect(html).toContain("Buffer 70% full");
   });
   it("caps the display at the requested clip length", () => {
      const html = renderToStaticMarkup(
         createElement(RecordingStatus, {
            state: {
               ...state,
               preferences: { ...state.preferences, clipSeconds: 30 },
               recorder: { ...state.recorder, state: "recording", availableSeconds: 95 },
            },
            visible: true,
         })
      );
      expect(html).toContain("0:30 available");
      expect(html).toContain("Buffer 100% full");
      expect(html).toContain('class="buffer-ring rolling"');
      expect(html).toContain('stroke-dasharray="94 100"');
      expect(html).toContain(`animation-duration:${30 / 0.94}s`);
   });
   it("retains recording status and background activity alongside the buffer", () => {
      const html = renderToStaticMarkup(
         createElement(RecordingStatus, {
            state: {
               ...state,
               recorder: {
                  ...state.recorder,
                  state: "recording",
                  startedAt: Date.now() - 125000,
                  sourceName: "Window title",
                  availableSeconds: 10,
                  pendingSaves: 2,
               },
            },
            visible: true,
         })
      );
      expect(html).toContain("0:10 available");
      expect(html).toContain("Window title");
      expect(html).toContain("Recording");
      expect(html).toContain("Saving");
      expect(html).not.toContain("2:05");
   });
   it("keeps the startup headline while source status updates underneath", () => {
      const html = renderToStaticMarkup(
         createElement(RecordingStatus, {
            state: {
               ...state,
               recorder: { ...state.recorder, state: "waiting", message: "Waiting for source", startingDetail: "Waiting for source" },
            },
            visible: true,
         })
      );
      expect(html).toContain('title="Starting recording..."');
      expect(html).toContain('class="status-message" title="Waiting for source"');
      expect(html).not.toContain("available</span>");
   });
   it.each(["stopped", "starting", "waiting", "error"] as const)("hides available time while %s", (phase) => {
      const html = renderToStaticMarkup(createElement(RecordingStatus, { state: { ...state, recorder: { ...state.recorder, state: phase } }, visible: true }));
      expect(html).not.toContain("available</span>");
      expect(html).not.toContain("buffer-ring");
      expect(html.includes(' spin"')).toBe(phase === "starting" || phase === "waiting");
   });
});

it("uses the same headline and detail in the recording loading view", async () => {
   const { Recording } = await import("./Recording");
   const html = renderToStaticMarkup(
      createElement(Recording, {
         state: { ...state, recorder: { ...state.recorder, state: "waiting", startingDetail: "Waiting for source" } },
         visible: true,
         run: async () => true,
         pulse: 0,
         openGames: () => undefined,
      })
   );
   expect(html).toContain('class="preview-message recording-startup"');
   expect(html).toContain("<h3>Starting recording...</h3>");
   expect(html).toContain("<p>Waiting for source</p>");
});

it("preserves browser and cross-realm error messages", async () => {
   const { describeError } = await import("./desktop");
   expect(describeError({ name: "NotReadableError", message: "Could not start video source" })).toBe("Could not start video source");
   expect(describeError(new DOMException("Capture denied", "NotAllowedError"))).toBe("Capture denied");
});

it("keeps normal file drags native and reserves HTML folder moves for Shift", async () => {
   const { api, fileDragProps } = await import("./desktop");
   api.dragFile = vi.fn();
   const data = { setData: vi.fn(), effectAllowed: "all" };
   const preventDefault = vi.fn();
   const event = { shiftKey: false, preventDefault, dataTransfer: data } as unknown as DragEvent;
   const props = fileDragProps("/clips/video.mp4", { id: "clip", collection: "/clips" });
   props.onDragStart(event);
   expect(api.dragFile).toHaveBeenCalledWith("/clips/video.mp4");
   expect(preventDefault).toHaveBeenCalledOnce();
   expect(data.setData).not.toHaveBeenCalled();
   vi.mocked(api.dragFile).mockClear();
   preventDefault.mockClear();
   props.onDragStart({ ...event, shiftKey: true });
   expect(api.dragFile).not.toHaveBeenCalled();
   expect(preventDefault).not.toHaveBeenCalled();
   expect(data.setData).toHaveBeenCalledWith("application/x-acroclip-clip", JSON.stringify({ id: "clip", collection: "/clips" }));
   expect(data.effectAllowed).toBe("move");
});
