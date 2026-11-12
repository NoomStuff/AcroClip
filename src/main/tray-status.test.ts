import { describe, expect, it, vi } from "vitest";
import { trayStatus } from "./tray";
import { stoppedRecorder } from "../shared/defaults";
import type { RecorderState } from "../shared/types";

vi.mock("electron", () => ({ Menu: { buildFromTemplate: (items: Electron.MenuItemConstructorOptions[]) => items } }));
const actions = { open: vi.fn(), toggleRecording: vi.fn(), saveClip: vi.fn(), exit: vi.fn() };
function update(status: RecorderState) {
   const tooltip = vi.fn();
   trayStatus({ setToolTip: tooltip, setContextMenu: vi.fn() }, actions)(status, false);
   return tooltip.mock.calls[0]?.[0] as string;
}

describe("actual tray status", () => {
   it("uses the waiting reason and a neutral fallback for unknown reasons", () => {
      expect(update({ ...stoppedRecorder, state: "waiting", message: "Microphone: selected device is unavailable" })).toBe(
         "AcroClip · Capture paused · Microphone: selected device is unavailable"
      );
      expect(update({ ...stoppedRecorder, state: "waiting", message: "" })).toBe("AcroClip · Capture paused");
   });
   it("keeps persistent failure visible and ordinary idle/capture wording intact", () => {
      expect(update({ ...stoppedRecorder, state: "error", message: "Capture stopped unexpectedly with exit code 17" })).toBe(
         "AcroClip · Capture stopped unexpectedly with exit code 17"
      );
      expect(update({ ...stoppedRecorder, state: "recording" })).toBe("AcroClip · Capturing");
      expect(update(stoppedRecorder)).toBe("AcroClip");
   });
   it("rebuilds the menu only when what it shows changes", () => {
      const menu = vi.fn();
      const update = trayStatus({ setToolTip: vi.fn(), setContextMenu: menu }, actions);
      update({ ...stoppedRecorder, state: "recording", availableSeconds: 1 }, false);
      update({ ...stoppedRecorder, state: "recording", availableSeconds: 2 }, false);
      expect(menu).toHaveBeenCalledTimes(1);
      update({ ...stoppedRecorder, state: "recording", availableSeconds: 2 }, true);
      update({ ...stoppedRecorder, state: "waiting", message: "Waiting for game" }, false);
      expect(menu).toHaveBeenCalledTimes(3);
   });
});
