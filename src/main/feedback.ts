import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { nativeImage, Notification } from "electron";

export interface FeedbackDetails {
   completed?: boolean;
   replay?: boolean;
   pulse?: boolean;
   recordingStatus?: "starting" | "recording" | "paused" | "stopped" | "error";
   errorTitle?: string;
   detail?: string;
   artwork?: string;
   /** The artwork is an application icon, drawn inside the tile instead of filling it like a clip thumbnail. */
   artworkIcon?: boolean;
   sound?: string;
   visual?: boolean;
   preserveBanner?: boolean;
}

interface SystemNotice {
   title: string;
   body: string;
   busy: boolean;
}
/** The banner's two lines, for desktops that show a system notification instead. */
function systemNotice(message: string, error: boolean, busy: boolean, details: FeedbackDetails): SystemNotice {
   if (error) return { title: details.errorTitle || "AcroClip error", body: details.errorTitle ? details.detail || "" : message, busy };
   return { title: message, body: details.detail ?? "", busy };
}

const HELPER_RESTARTS = 2;

/** Feedback is independent of the library renderer and never acquires focus. */
export class Feedback {
   private child: ChildProcessWithoutNullStreams | null = null;
   private notification: Notification | null = null;
   private visible: { id: string; notice: SystemNotice } | null = null;
   /** The system notification on screen, so busy updates with the same title do not post again. */
   private shown: SystemNotice | null = null;
   private displayTimeout: ReturnType<typeof setTimeout> | null = null;
   /** A helper that has shown a banner is warm. Until then the deadline also covers its start, which a fresh install slows while it is scanned. */
   private helperShown = false;
   private awaitingShown: string | null = null;
   private sequence = 0;
   /** Failures so far. The helper restarts after each one, up to a limit, then the session stays on system notifications. */
   private helperFailures = 0;
   private readonly executable: string;
   private readonly onWarning: (message: string) => void;
   private readonly icon: string;
   private readonly artwork: string;
   constructor(executable: string, onWarning: (message: string) => void, icon: string) {
      this.executable = executable;
      this.onWarning = onWarning;
      this.icon = icon;
      this.artwork = nativeImage.createFromPath(icon).resize({ width: 128, height: 128 }).toDataURL();
   }
   private get helperAvailable(): boolean {
      return this.helperFailures <= HELPER_RESTARTS && existsSync(this.executable);
   }
   /** Starts the helper ahead of the first banner, so that banner does not wait for the process to load. */
   start(): void {
      if (this.child || !this.helperAvailable) return;
      try {
         this.helper();
      } catch (failure) {
         this.startFailed(failure);
      }
   }
   show(message: string, error = false, saving = false, details: FeedbackDetails = {}): void {
      if (details.visual === false && !details.sound && !this.child) return;
      if (details.sound && process.platform === "linux") {
         const player = spawn("paplay", [details.sound], { windowsHide: true, stdio: "ignore" });
         player.once("error", (failure) => this.onWarning(`Feedback sound failed: ${failure.message}`));
      }
      if (this.helperAvailable) {
         try {
            const child = this.helper();
            const id = String(++this.sequence);
            // An empty window thumbnail arrives as a data URL with no image in it.
            const artwork = details.artwork && /^data:image\/[\w.+-]+;base64,./.test(details.artwork) ? details.artwork : "";
            if (details.visual !== false) {
               this.clearDisplayTimeout();
               this.visible = { id, notice: systemNotice(message, error, saving, details) };
               this.awaitingShown = id;
               // A busy main thread runs this timer before it reads an acknowledgement already waiting in the pipe. setImmediate reads the pipe first.
               this.displayTimeout = setTimeout(
                  () =>
                     setImmediate(() => {
                        if (this.awaitingShown === id) this.failHelper(child, "Banner display timed out");
                     }),
                  this.helperShown ? 2000 : 6000
               );
               this.displayTimeout.unref();
            } else if (!details.preserveBanner) {
               this.clearDisplayTimeout();
               this.visible = null;
            }
            child.stdin.write(
               `${JSON.stringify({ id, message: message.slice(0, 4000), error, saving, ...details, sound: process.platform === "linux" ? undefined : details.sound, artwork: details.recordingStatus ? "" : artwork || this.artwork, artworkIcon: details.artworkIcon === true || !artwork })}\n`
            );
            return;
         } catch (failure) {
            if (this.child) {
               this.failHelper(this.child, failure instanceof Error ? failure.message : "Native feedback could not start");
               return;
            }
            this.startFailed(failure);
         }
      }
      if (details.visual !== false) this.system(systemNotice(message, error, saving, details));
   }
   private helper(): ChildProcessWithoutNullStreams {
      if (this.child) return this.child;
      const child = spawn(this.executable, [], { windowsHide: true, stdio: "pipe" });
      this.child = child;
      const output = createInterface({ input: child.stdout });
      output.on("line", (line) => {
         if (this.child !== child) return;
         let event: unknown;
         try {
            event = JSON.parse(line);
         } catch {
            return;
         }
         if (!event || typeof event !== "object" || !("id" in event) || event.id !== this.visible?.id || !("event" in event)) return;
         if (event.event === "shown" && "visible" in event && event.visible === true) {
            this.helperShown = true;
            this.clearDisplayTimeout();
         } else if (event.event === "hidden") {
            this.clearDisplayTimeout();
            this.visible = null;
         } else if (event.event === "failed" || event.event === "shown") this.failHelper(child, "Banner could not display");
      });
      child.once("close", () => output.close());
      child.stderr.on("data", (value: Buffer) => this.onWarning(value.toString("utf8").slice(0, 4000)));
      child.once("error", (failure) => {
         this.failHelper(child, failure.message);
      });
      child.once("exit", () => {
         this.failHelper(child, "Notification helper exited unexpectedly");
      });
      child.stdin.on("error", (failure) => this.failHelper(child, failure.message));
      return child;
   }
   private startFailed(failure: unknown): void {
      this.helperFailures++;
      this.onWarning(failure instanceof Error ? failure.message : "Native feedback could not start");
   }
   private clearDisplayTimeout(): void {
      if (this.displayTimeout) clearTimeout(this.displayTimeout);
      this.displayTimeout = null;
      this.awaitingShown = null;
   }
   private failHelper(child: ChildProcessWithoutNullStreams, reason: string): void {
      if (this.child !== child) return;
      this.child = null;
      this.helperFailures++;
      this.helperShown = false;
      this.clearDisplayTimeout();
      const pending = this.visible;
      this.visible = null;
      this.onWarning(`Native feedback failed: ${reason}`);
      child.kill();
      if (pending) this.system(pending.notice);
   }
   private system(notice: SystemNotice): void {
      // Progress such as "Starting capture…" changes its detail often. A banner animates that; a system notification would post again each time.
      if (notice.busy && this.notification && this.shown?.title === notice.title) return;
      try {
         if (!Notification.isSupported()) {
            this.onWarning("System notifications are unavailable");
            return;
         }
         this.notification?.close();
         this.shown = notice;
         this.notification = new Notification({ title: notice.title, body: notice.body, icon: this.icon, silent: true });
         this.notification.on("failed", (_event, reason) => this.onWarning(`System feedback failed: ${reason}`));
         this.notification.on("close", () => {
            if (this.shown === notice) this.shown = null;
         });
         this.notification.show();
      } catch (failure) {
         this.onWarning(`System feedback failed: ${failure instanceof Error ? failure.message : "Notification could not display"}`);
      }
   }
   close(): void {
      this.clearDisplayTimeout();
      this.visible = null;
      this.notification?.close();
      const child = this.child;
      this.child = null;
      if (!child) return;
      child.stdin.end(`${JSON.stringify({ action: "exit" })}\n`);
      const timeout = setTimeout(() => child.kill(), 1000);
      timeout.unref();
      child.once("exit", () => clearTimeout(timeout));
   }
}
