import { app, net, shell } from "electron";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AvailableUpdate, UpdateState, UpdateStatus } from "../shared/types";
import { fetchAvailableUpdate, isNewerVersion, UpdateManager } from "./update-manager";

/** Automatic checks run at most this often; manual checks always run. */
export const BACKGROUND_CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const installRecordSchema = z.object({ fromVersion: z.string(), targetVersion: z.string(), startedAt: z.number() });

export interface InstallHooks {
   /** Finishes work and releases the app for the installer. false keeps the app open. */
   prepare: (progress: (message: string) => void) => Promise<boolean>;
   /** Restores the app when the installer could not start. */
   recover: () => void;
}

// One state snapshot serves Settings and the titlebar, including events received while hidden.
export class Updates {
   state: UpdateState = { state: "idle", version: "", progress: 0, message: "" };
   private available: AvailableUpdate | null = null;
   private lastChecked: number | undefined;
   private lastAttempt = 0;
   private installing = false;
   private readonly manager: UpdateManager;
   private readonly changed: () => void;
   private readonly log: (message: string) => void;
   constructor(changed: () => void, log: (message: string) => void = () => undefined) {
      this.changed = changed;
      this.log = log;
      this.manager = new UpdateManager((status) => this.status(status), log);
   }
   private get recordPath(): string {
      return join(app.getPath("userData"), "update-install.json");
   }
   private set(state: UpdateState) {
      this.state = { ...state, ...(this.lastChecked ? { lastChecked: this.lastChecked } : {}) };
      this.changed();
   }
   private status(status: UpdateStatus) {
      if (this.available && status.version !== this.available.version) return;
      if (this.installing && status.phase !== "error") return;
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
      if (!manual && Date.now() - this.lastAttempt < BACKGROUND_CHECK_INTERVAL - 60_000) return;
      if (this.installing || ["checking", "downloading", "installing"].includes(this.state.state)) return;
      this.lastAttempt = Date.now();
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
   async install(hooks: InstallHooks): Promise<void> {
      if (!this.manager.isReady) throw new Error("The update is not ready yet.");
      if (this.installing) return;
      const ready = this.state;
      const version = ready.version;
      const started = Date.now();
      this.installing = true;
      const progress = (message: string) => this.set({ ...ready, state: "installing", progress: 100, indeterminate: true, message });
      progress("Restarting to update");
      let released = false;
      const fail = (message: string) => {
         this.installing = false;
         void rm(this.recordPath, { force: true }).catch(() => undefined);
         if (released) hooks.recover();
         this.log(`update: install of ${version} failed after ${Date.now() - started} ms: ${message}`);
         this.set({ ...ready, state: "error", message });
      };
      try {
         if (!(await hooks.prepare(progress))) {
            this.installing = false;
            this.set(ready);
            return;
         }
         released = true;
         this.log(`update: released the app for ${version} after ${Date.now() - started} ms`);
         await writeFile(this.recordPath, JSON.stringify({ fromVersion: app.getVersion(), targetVersion: version, startedAt: Date.now() })).catch(
            () => undefined
         );
         this.manager.install(fail);
      } catch (error) {
         fail(error instanceof Error ? error.message : "Could not apply the update. Open the release to update manually.");
      }
   }
   /** Reports an install the previous session started that did not change the version. */
   async reviewPreviousInstall(): Promise<string | null> {
      const text = await readFile(this.recordPath, "utf8").catch(() => null);
      if (text === null) return null;
      await rm(this.recordPath, { force: true }).catch(() => undefined);
      const record = installRecordSchema.safeParse(
         (() => {
            try {
               return JSON.parse(text);
            } catch {
               return null;
            }
         })()
      );
      if (!record.success) return null;
      const { fromVersion, targetVersion } = record.data;
      const current = app.getVersion();
      if (current !== fromVersion || isNewerVersion(current, targetVersion)) {
         this.log(`update: ${fromVersion} -> ${current} applied`);
         return null;
      }
      this.log(`update: ${targetVersion} did not apply; still ${current}`);
      return `The update to AcroClip ${targetVersion} didn't install. Try it again from the update button, or download it from the release page.`;
   }
}
