import { Menu, type Tray } from "electron";
import type { RecorderState } from "../shared/types";

export function updateTray(
   tray: Pick<Tray, "setToolTip" | "setContextMenu">,
   status: RecorderState,
   starting: boolean,
   actions: { open: () => void; toggleRecording: () => void; saveClip: () => void; exit: () => void }
): void {
   const active = status.state === "recording" || status.state === "waiting";
   const detail =
      status.state === "waiting"
         ? status.message || "Waiting for capture"
         : status.state === "error"
           ? status.message || "Recording stopped"
           : active
             ? "Recording"
             : "";
   tray.setToolTip(detail ? `AcroClip · ${detail}` : "AcroClip");
   tray.setContextMenu(
      Menu.buildFromTemplate([
         { label: "Open AcroClip", click: actions.open },
         { label: active ? "Stop recording" : "Start recording", enabled: !starting, click: actions.toggleRecording },
         { label: "Save clip", enabled: active, click: actions.saveClip },
         { type: "separator" },
         { label: "Exit", click: actions.exit },
      ])
   );
}
