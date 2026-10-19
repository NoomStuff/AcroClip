import type { AvailableUpdate, UpdateState, UpdateStatus } from "../../shared/types";
import { api } from "./ui";
import type { Run } from "./ui";
import { UpdateChip } from "./UpdateChip";

export function AppUpdate({ state, run }: { state: UpdateState; run: Run }) {
   if (!state.version || !state.mode || ["idle", "checking"].includes(state.state)) return null;
   const update: AvailableUpdate = {
      version: state.version,
      name: `AcroClip ${state.version}`,
      mode: state.mode,
      url: state.url ?? "https://github.com/NoomStuff/AcroClip/releases/latest",
   };
   const status: UpdateStatus | null = ["downloading", "ready", "downloaded", "error"].includes(state.state)
      ? {
           phase: state.state as UpdateStatus["phase"],
           version: state.version,
           percent: state.indeterminate ? null : state.progress,
           message: state.message,
           ...(state.path ? { path: state.path } : {}),
        }
      : null;
   return (
      <UpdateChip
         update={update}
         status={status}
         onDownload={() => void run(() => api.downloadUpdate())}
         onRestart={() => void run(() => api.installUpdate())}
         onRelease={() => void run(() => api.openUpdateRelease())}
         onReveal={() => void run(() => api.revealUpdate())}
      />
   );
}
