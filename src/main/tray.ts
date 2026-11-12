import { Menu, type Tray } from "electron";
import type { RecorderState } from "../shared/types";

interface TrayActions {
   open: () => void;
   toggleRecording: () => void;
   saveClip: () => void;
   exit: () => void;
}

/**
 * Keeps the tray's tooltip and menu in step with capture. The recorder reports every second, so
 * the native menu is only rebuilt when what it shows has changed.
 */
export function trayStatus(tray: Pick<Tray, "setToolTip" | "setContextMenu">, actions: TrayActions): (status: RecorderState, starting: boolean) => void {
   let shown = "";
   return (status, starting) => {
      const active = status.state === "recording" || status.state === "waiting";
      const detail =
         status.state === "waiting"
            ? `Capture paused${status.message ? ` · ${status.message}` : ""}`
            : status.state === "error"
              ? status.message || "Capture stopped"
              : active
                ? "Capturing"
                : "";
      const next = JSON.stringify([detail, active, starting]);
      if (next === shown) return;
      shown = next;
      tray.setToolTip(detail ? `AcroClip · ${detail}` : "AcroClip");
      tray.setContextMenu(
         Menu.buildFromTemplate([
            { label: "Open AcroClip", click: actions.open },
            { label: active ? "Stop capturing" : "Start capturing", enabled: !starting, click: actions.toggleRecording },
            { label: "Save clip", enabled: active, click: actions.saveClip },
            { type: "separator" },
            { label: "Exit", click: actions.exit },
         ])
      );
   };
}
