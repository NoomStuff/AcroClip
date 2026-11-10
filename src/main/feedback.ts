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
   if (error) return { title: details.errorTitle || "AcroClip needs attention", body: details.errorTitle ? details.detail || "" : message, busy };
   return { title: message, body: details.detail ?? "", busy };
}

/** Feedback is independent of the library renderer and never acquires focus. */
export class Feedback {
   private child: ChildProcessWithoutNullStreams | null = null;
   private notification: Notification | null = null;
   private visible: { id: string; notice: SystemNotice } | null = null;
   /** The system notification on screen, so busy updates with the same title do not post again. */
   private shown: SystemNotice | null = null;
   private displayTimeout: ReturnType<typeof setTimeout> | null = null;
   private sequence = 0;
   private helperFailed = false;
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
   show(message: string, error = false, saving = false, details: FeedbackDetails = {}): void {
      if (details.visual === false && !details.sound && !this.child) return;
      if (details.sound && process.platform === "linux") {
         const player = spawn("paplay", [details.sound], { windowsHide: true, stdio: "ignore" });
         player.once("error", (failure) => this.onWarning(`Feedback sound failed: ${failure.message}`));
      }
      if (!this.helperFailed && existsSync(this.executable)) {
         try {
            const child = this.child ?? spawn(this.executable, [], { windowsHide: true, stdio: "pipe" });
            if (!this.child) {
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
                  if (event.event === "shown" && "visible" in event && event.visible === true) this.clearDisplayTimeout();
                  else if (event.event === "hidden") {
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
            }
            const id = String(++this.sequence);
            // An empty window thumbnail arrives as a data URL with no image in it.
            const artwork = details.artwork && /^data:image\/[\w.+-]+;base64,./.test(details.artwork) ? details.artwork : "";
            if (details.visual !== false) {
               this.clearDisplayTimeout();
               this.visible = { id, notice: systemNotice(message, error, saving, details) };
               this.displayTimeout = setTimeout(() => this.failHelper(child, "Banner display timed out"), 2000);
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
            this.helperFailed = true;
            this.onWarning(failure instanceof Error ? failure.message : "Native feedback could not start");
         }
      }
      if (details.visual !== false) this.system(systemNotice(message, error, saving, details));
   }
   private clearDisplayTimeout(): void {
      if (this.displayTimeout) clearTimeout(this.displayTimeout);
      this.displayTimeout = null;
   }
   private failHelper(child: ChildProcessWithoutNullStreams, reason: string): void {
      if (this.child !== child) return;
      this.child = null;
      this.helperFailed = true;
      this.clearDisplayTimeout();
      const pending = this.visible;
      this.visible = null;
      this.onWarning(`Native feedback failed: ${reason}`);
      child.kill();
      if (pending) this.system(pending.notice);
   }
   private system(notice: SystemNotice): void {
      // Progress such as "Starting capture..." changes its detail often. A banner animates that; a system notification would post again each time.
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
