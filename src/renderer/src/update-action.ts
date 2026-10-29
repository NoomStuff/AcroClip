import type { UpdateState } from "../../shared/types";

export type UpdateAction = "installUpdate" | "revealUpdate" | "downloadUpdate" | "openUpdateRelease";

export function updateDownloading(state: UpdateState): boolean {
   return state.state === "downloading" || (state.state === "available" && state.mode === "automatic");
}

export function updateAction(state: UpdateState): { method: UpdateAction; label: string } | null {
   if (updateDownloading(state) || !state.version || !state.mode) return null;
   switch (state.state) {
      case "ready":
         return { method: "installUpdate", label: "Restart to update" };
      case "downloaded":
         return { method: "revealUpdate", label: "Show in Downloads" };
      case "available":
      case "error":
         return state.mode === "download"
            ? { method: "downloadUpdate", label: state.state === "error" ? "Retry download" : "Download update" }
            : { method: "openUpdateRelease", label: "View release" };
      default:
         return null;
   }
}

export function updateDownloadLabel(state: UpdateState): string {
   return state.indeterminate ? "Downloading update" : `Downloading ${Math.round(state.progress)}%`;
}
