import { describe, expect, it, vi } from "vitest";
import { updateTray } from "./tray";
import { stoppedRecorder } from "../shared/defaults";
import type { RecorderState } from "../shared/types";

vi.mock("electron", () => ({ Menu: { buildFromTemplate: (items: Electron.MenuItemConstructorOptions[]) => items } }));
function update(status: RecorderState) {
   const tooltip = vi.fn();
   updateTray({ setToolTip: tooltip, setContextMenu: vi.fn() }, status, false, {
      open: vi.fn(),
      toggleRecording: vi.fn(),
      saveClip: vi.fn(),
      exit: vi.fn(),
   });
   return tooltip.mock.calls[0]?.[0] as string;
}

describe("actual tray status", () => {
   it("uses the waiting reason and a neutral fallback for unknown reasons", () => {
      expect(update({ ...stoppedRecorder, state: "waiting", message: "Microphone: selected device is unavailable" })).toBe(
         "AcroClip · Microphone: selected device is unavailable"
      );
      expect(update({ ...stoppedRecorder, state: "waiting", message: "" })).toBe("AcroClip · Waiting for capture");
   });
   it("keeps persistent failure visible and ordinary idle/capture wording intact", () => {
      expect(update({ ...stoppedRecorder, state: "error", message: "Recording stopped unexpectedly with exit code 17" })).toBe(
         "AcroClip · Recording stopped unexpectedly with exit code 17"
      );
      expect(update({ ...stoppedRecorder, state: "recording" })).toBe("AcroClip · Recording");
      expect(update(stoppedRecorder)).toBe("AcroClip");
   });
});
