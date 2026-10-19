import { app, net, shell } from "electron";
import type { AvailableUpdate, UpdateState, UpdateStatus } from "../shared/types";
import { fetchAvailableUpdate, UpdateManager } from "./update-manager";

// One state snapshot serves Settings and the titlebar, including events received while hidden.
export class Updates {
   state: UpdateState = { state: "idle", version: "", progress: 0, message: "" };
   private available: AvailableUpdate | null = null;
   private checked = false;
   private lastChecked: number | undefined;
   private readonly manager: UpdateManager;
   private readonly changed: () => void;
   constructor(changed: () => void) {
      this.changed = changed;
      this.manager = new UpdateManager((status) => this.status(status));
   }
   private set(state: UpdateState) {
      this.state = { ...state, ...(this.lastChecked ? { lastChecked: this.lastChecked } : {}) };
      this.changed();
   }
   private status(status: UpdateStatus) {
      if (this.available && status.version !== this.available.version) return;
      this.set({
         state: status.phase,
         version: status.version,
         progress: status.percent ?? 0,
         indeterminate: status.percent === null,
         message:
            status.message ?? (status.phase === "ready" ? "Ready to restart" : status.phase === "downloaded" ? "Saved to Downloads" : "Downloading update"),
         ...(this.available ? { mode: this.available.mode, url: this.available.url } : {}),
         ...(status.path ? { path: status.path } : {}),
      });
   }
   async check(manual = true): Promise<void> {
      if (!manual && this.checked) return;
      if (["checking", "downloading"].includes(this.state.state)) return;
      this.checked = true;
      const previous = this.state;
      this.set({ ...this.state, state: "checking", message: "Checking for updates" });
      try {
         const update = await fetchAvailableUpdate(app.getVersion(), (url, init) => net.fetch(url, init));
         this.lastChecked = Date.now();
         if (!update) {
            this.available = null;
            this.set({ state: "idle", version: "", progress: 0, message: manual ? "You're up to date" : "" });
            return;
         }
         this.available = update;
         const offered = await this.manager.offer(update);
         this.available = offered;
         if (previous.version === offered.version && ((previous.state === "ready" && this.manager.isReady) || previous.state === "downloaded")) {
            this.set({ ...previous, mode: offered.mode, url: offered.url });
            return;
         }
         if (this.state.version === offered.version && ["downloading", "ready", "downloaded", "error"].includes(this.state.state))
            this.set({ ...this.state, mode: offered.mode, url: offered.url });
         else this.set({ state: "available", version: offered.version, progress: 0, message: "An update is available", mode: offered.mode, url: offered.url });
      } catch {
         if (manual) this.set({ ...previous, state: "error", message: "Couldn't check for updates. Try again later." });
         else this.set(previous);
      }
   }
   async download(): Promise<void> {
      if (!this.available) throw new Error("No update is available.");
      if (this.state.state === "downloading") return;
      this.set({ ...this.state, state: "downloading", progress: 0, indeterminate: true, message: "Downloading update" });
      try {
         await this.manager.downloadPortable(this.available.version);
      } catch (error) {
         if (this.state.state !== "error")
            this.set({ ...this.state, state: "error", message: error instanceof Error ? error.message : "The download failed." });
      }
   }
   async reveal(): Promise<void> {
      if (!this.manager.downloadedPath) throw new Error("No verified update download is available.");
      shell.showItemInFolder(this.manager.downloadedPath);
   }
   async release(): Promise<void> {
      if (this.available) await shell.openExternal(this.available.url);
   }
   async install(before: () => Promise<boolean>): Promise<void> {
      if (!this.manager.isReady) throw new Error("The update is not ready yet.");
      if (!(await before())) return;
      try {
         this.manager.install();
      } catch (error) {
         this.set({
            ...this.state,
            state: "error",
            message: error instanceof Error ? error.message : "Could not apply the update. Open the release to update manually.",
         });
      }
   }
}
