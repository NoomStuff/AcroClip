import { desktopCapturer, nativeImage, screen } from "electron";
import type { DesktopCapturerSource } from "electron";
import { createHash, randomUUID } from "node:crypto";
import type { CaptureSource } from "../shared/types";
import { portalSources } from "../shared/capture-policy";
import type { Recorder } from "./recorder";

export class CaptureSources {
   cached: CaptureSource[] = [];
   private previewSources = new Map<string, DesktopCapturerSource>();
   private previewPids = new Map<string, number>();
   private displayLayout = "";
   private query: Promise<CaptureSource[]> | null = null;
   private loadedAt = 0;
   private readonly recorder: Recorder;
   private readonly ownWindow: () => string;
   constructor(recorder: Recorder, ownWindow: () => string) {
      this.recorder = recorder;
      this.ownWindow = ownWindow;
   }
   async list(): Promise<CaptureSource[]> {
      if (this.query) return this.query;
      if (Date.now() - this.loadedAt < 750) return this.cached;
      this.query = this.load()
         .then((result) => {
            this.loadedAt = Date.now();
            return result;
         })
         .finally(() => {
            this.query = null;
         });
      return this.query;
   }
   private async load(): Promise<CaptureSource[]> {
      if (process.platform === "linux") {
         const capabilities = await this.recorder.capabilities();
         const candidates = capabilities.applicationBackend === "xwayland" ? await this.recorder.applicationCandidates() : [];
         const choices = portalSources(capabilities, candidates);
         if (choices !== null) return (this.cached = choices);
         // Electron's independent portal session would ask twice and cannot name the native selection.
         if (process.env["WAYLAND_DISPLAY"]) return (this.cached = []);
      }
      const nativeWindows = process.platform === "win32" ? await this.recorder.capturableApplications() : [];
      const displayLayout = JSON.stringify([
         screen.getPrimaryDisplay().id,
         screen.getAllDisplays().map((display) => [display.id, display.bounds, display.scaleFactor]),
      ]);
      const sameWindows =
         nativeWindows.length === this.previewPids.size && nativeWindows.every((source) => this.previewPids.get(source.id.split(":")[1]!) === source.pid);
      if (process.platform === "win32" && this.cached.length && sameWindows && displayLayout === this.displayLayout) {
         this.cached = this.cached.map((source) => {
            const candidate = source.kind === "app" ? nativeWindows.find((candidate) => candidate.id.split(":")[1] === source.id.split(":")[1]) : undefined;
            return candidate
               ? { ...source, name: candidate.name, processId: candidate.pid, ...(candidate.pixelSize ? { pixelSize: candidate.pixelSize } : {}) }
               : source;
         });
         return this.cached;
      }
      const list = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      this.displayLayout = displayLayout;
      const allowedWindows = process.platform === "win32" ? new Set(nativeWindows.map((item) => item.id.split(":")[1])) : null;
      this.previewSources = new Map(list.map((source) => [source.id, { ...source, thumbnail: nativeImage.createEmpty() }]));
      this.previewPids = new Map(nativeWindows.map((source) => [source.id.split(":")[1]!, source.pid]));
      this.cached = list
         .filter(
            (s) => s.id.split(":")[1] !== this.ownWindow() && (!allowedWindows || s.id.startsWith("screen:") || allowedWindows.has(s.id.split(":")[1] ?? ""))
         )
         .map((s) => {
            const display = screen.getAllDisplays().find((item) => String(item.id) === s.display_id);
            const bounds = display ? (process.platform === "win32" ? screen.dipToScreenRect(null, display.bounds) : display.bounds) : undefined;
            const candidate = nativeWindows.find((item) => item.id.split(":")[1] === s.id.split(":")[1]);
            let appIcon: string | undefined;
            try {
               if (s.appIcon && !s.appIcon.isEmpty()) {
                  const value = s.appIcon.resize({ width: 32, height: 32 }).toDataURL();
                  if (value.length <= 45000) appIcon = value;
               }
            } catch {
               /* A missing app icon must not make its capture source unavailable. */
            }
            const applicationId = s.id.startsWith("window:")
               ? createHash("sha256")
                    .update(
                       candidate?.executable
                          ? process.platform === "win32"
                             ? candidate.executable.toLowerCase()
                             : candidate.executable
                          : `window:${s.id}:${randomUUID()}`
                    )
                    .digest("hex")
               : undefined;
            return {
               ...(applicationId ? { applicationId } : {}),
               ...(appIcon ? { appIcon } : {}),
               id: s.id,
               name: s.name,
               kind: s.id.startsWith("screen:") ? "screen" : "app",
               thumbnail: s.thumbnail.toDataURL(),
               ...(candidate ? { processId: candidate.pid } : {}),
               ...(bounds ? { bounds } : {}),
               ...(display
                  ? {
                       pixelSize: {
                          width: Math.round(display.size.width * display.scaleFactor),
                          height: Math.round(display.size.height * display.scaleFactor),
                       },
                    }
                  : candidate?.pixelSize
                    ? { pixelSize: candidate.pixelSize }
                    : {}),
               ...(s.display_id ? { displayId: s.display_id } : {}),
            };
         });
      return this.cached;
   }
   async preview(id: string): Promise<DesktopCapturerSource[]> {
      const cached = this.previewSources.get(id);
      if (process.platform === "win32" && cached) {
         if (id.startsWith("window:")) {
            const handle = id.split(":")[1]!;
            const candidate = (await this.recorder.capturableApplications()).find((item) => item.id.split(":")[1] === handle);
            if (!candidate || candidate.pid !== this.previewPids.get(handle)) return [];
         } else if (!screen.getAllDisplays().some((display) => String(display.id) === cached.display_id)) return [];
         return [cached];
      }
      return desktopCapturer.getSources({ types: [id.startsWith("screen:") ? "screen" : "window"], thumbnailSize: { width: 0, height: 0 } });
   }
}
