import { describe, expect, it } from "vitest";
import { bufferedCaptureSource, portalScreenId, portalSources, sourceChoices, selectedCaptureSource, previewCaptureSource } from "./capture-policy";
import { defaultPreferences, stoppedRecorder } from "./defaults";
import type { RecordingCapabilities } from "./types";

const ready: RecordingCapabilities = {
   supported: true,
   hardwareEncoders: [],
   recommended: "low",
   message: "",
   captureBackend: "wayland-portal",
   sourceKinds: ["screen"],
   portalPicker: true,
};
it("uses the buffered application for saves while the selected source changes or waits", () => {
   for (const sourceKind of ["app", "waiting"] as const) {
      expect(
         bufferedCaptureSource({
            ...stoppedRecorder,
            state: "waiting",
            sourceKind,
            sourceId: "window:next",
            sourceName: "Next application",
            bufferedSourceName: "Previous application",
            bufferedSourceId: "window:previous",
            bufferedSourceKind: "app",
         })
      ).toEqual({ name: "Previous application", id: "window:previous", kind: "app" });
   }
});
describe("system picker capture policy", () => {
   it("exposes only the native screen picker and prevents unsupported app or auto selection", () => {
      const sources = portalSources(ready)!;
      expect(sources.map((source) => source.id)).toEqual([portalScreenId]);
      expect(
         sourceChoices(sources)
            .filter((choice) => !choice.disabled)
            .map((choice) => choice.value)
      ).toEqual(["screen"]);
   });
   it("does not advertise a picker unless the native backend confirms it is available", () => {
      expect(portalSources({ ...ready, supported: false })).toEqual([]);
      expect(portalSources({ ...ready, portalPicker: false })).toEqual([]);
      expect(portalSources({ ...ready, sourceKinds: [] })).toEqual([]);
      expect(sourceChoices([], { ...ready, supported: false }).find((choice) => choice.value === "app")?.disabled).toBe(true);
   });
   it("preserves ordinary screen and exact application capture on other backends", () => {
      expect(portalSources({ supported: true, hardwareEncoders: [], recommended: "low", message: "" })).toBeNull();
      expect(sourceChoices([]).every((choice) => !choice.disabled)).toBe(true);
   });
   it("offers XWayland applications only with the native connection and capability", () => {
      const capability: RecordingCapabilities = { ...ready, applicationBackend: "xwayland", sourceKinds: ["screen", "app", "auto"] };
      const candidates = [
         { id: "window:123:0", pid: 42, name: "Game", executable: "game.exe", foreground: true, fullscreen: false },
         { id: "portal:window", pid: 43, name: "Unverifiable selection", executable: "other", foreground: false, fullscreen: false },
         { id: "window:0:0", pid: 44, name: "Invalid", executable: "other", foreground: false, fullscreen: false },
      ];
      const sources = portalSources(capability, candidates)!;
      expect(sources.map((source) => source.id)).toEqual([portalScreenId, "window:123:0"]);
      expect(sourceChoices(sources, capability).every((choice) => !choice.disabled)).toBe(true);
      expect(portalSources(ready, candidates)!.map((source) => source.id)).toEqual([portalScreenId]);
      expect(portalSources({ ...capability, sourceKinds: ["screen"] }, candidates)!.length).toBe(1);
   });
   it("keeps Auto available with no running XWayland game, without enabling it on screen-only sessions", () => {
      const capability: RecordingCapabilities = { ...ready, applicationBackend: "xwayland", sourceKinds: ["screen", "app", "auto"] };
      const sources = portalSources(capability)!;
      expect(sourceChoices(sources, capability).find((choice) => choice.value === "auto")?.disabled).toBe(false);
      expect(sourceChoices(sources).find((choice) => choice.value === "auto")?.disabled).toBe(true);
      expect(sourceChoices(sources, { ...capability, sourceKinds: ["screen", "app"] }).find((choice) => choice.value === "auto")?.disabled).toBe(true);
   });
});

describe("saved capture selection", () => {
   const sources = [
      { id: "screen:0", kind: "screen" as const, name: "Screen", thumbnail: "" },
      { id: "window:1:0", kind: "app" as const, name: "App", thumbnail: "" },
   ];
   it("previews only the current auto capture, allowing a screen only with desktop fallback", () => {
      const preferences = { ...defaultPreferences, sourceKind: "auto" as const, desktopFallback: false };
      const recorder = { ...stoppedRecorder, state: "recording" as const, sourceKind: "app" as const, sourceId: "window:1:99" };
      expect(previewCaptureSource(sources, preferences, recorder)).toBe(sources[1]);
      expect(previewCaptureSource(sources, preferences, { ...recorder, state: "stopped" })).toBeUndefined();
      expect(previewCaptureSource(sources, preferences, { ...recorder, sourceId: "window:gone:0" })).toBeUndefined();
      const screen = { ...recorder, sourceKind: "screen" as const, sourceId: "screen:0" };
      expect(previewCaptureSource(sources, preferences, screen)).toBeUndefined();
      expect(previewCaptureSource(sources, { ...preferences, desktopFallback: true }, screen)).toBe(sources[0]);
      expect(previewCaptureSource(sources, { ...preferences, sourceKind: "app", sourceId: "window:1:0" }, stoppedRecorder)).toBe(sources[1]);
   });
   it("requires both the selected ID and capture mode to match", () => {
      expect(selectedCaptureSource(sources, { sourceKind: "app", sourceId: "screen:0" })).toBeUndefined();
      expect(selectedCaptureSource(sources, { sourceKind: "screen", sourceId: "window:1:0" })).toBeUndefined();
      expect(selectedCaptureSource(sources, { sourceKind: "app", sourceId: "window:1:0" })).toBe(sources[1]);
   });
   it("does not substitute another source for a stale saved ID", () => {
      expect(selectedCaptureSource(sources, { sourceKind: "app", sourceId: "window:gone:0" })).toBeUndefined();
      expect(selectedCaptureSource(sources, { sourceKind: "screen", sourceId: "screen:gone" })).toBeUndefined();
      expect(selectedCaptureSource(sources, { sourceKind: "app", sourceId: "" })).toBeUndefined();
      expect(selectedCaptureSource(sources, { sourceKind: "screen", sourceId: "" })).toBe(sources[0]);
   });
});
