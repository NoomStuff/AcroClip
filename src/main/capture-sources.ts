import { isWaylandSession } from "./linux-session";
import { app, desktopCapturer, nativeImage, screen } from "electron";
import type { DesktopCapturerSource } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureSource, GameCandidate } from "../shared/types";
import { portalSources } from "../shared/capture-policy";
import type { Recorder } from "./recorder";
import { applicationLabel, executableLabel } from "./application-identity";
type SourceRecorder = Pick<Recorder, "capabilities" | "applicationCandidates" | "capturableApplications">;

export class CaptureSources {
   cached: CaptureSource[] = [];
   private previewSources = new Map<string, DesktopCapturerSource>();
   private previewPids = new Map<string, number>();
   private query: Promise<CaptureSource[]> | null = null;
   private thumbnailQuery: Promise<CaptureSource[]> | null = null;
   private loadedAt = 0;
   private thumbnailAt = new Map<string, number>();
   private readonly stableWindowIcons = new Map<string, string>();
   private readonly icons = new Map<string, Promise<string | undefined>>();
   private genericIcon: Promise<string | undefined> | undefined;
   private readonly recorder: SourceRecorder;
   private readonly ownWindow: () => string;
   private readonly onChange: (sources: CaptureSource[]) => void;
   constructor(recorder: SourceRecorder, ownWindow: () => string, onChange: (sources: CaptureSource[]) => void = () => undefined) {
      this.recorder = recorder;
      this.ownWindow = ownWindow;
      this.onChange = onChange;
   }
   async list(thumbnails = false): Promise<CaptureSource[]> {
      if (thumbnails) {
         await this.list();
         if (!this.thumbnailQuery)
            this.thumbnailQuery = this.loadThumbnails().finally(() => {
               this.thumbnailQuery = null;
            });
         return this.thumbnailQuery;
      }
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
         if (isWaylandSession()) return (this.cached = []);
      }
      // Discovery needs identities, not captured images. Run the independent
      // enumerations together, and fetch Windows executable icons afterwards.
      const [nativeWindows, list] = await Promise.all([
         ["win32", "linux"].includes(process.platform) ? this.recorder.capturableApplications() : this.recorder.applicationCandidates().catch(() => []),
         desktopCapturer.getSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 0, height: 0 },
            fetchWindowIcons: true,
         }),
      ]);
      const previous = new Map(this.cached.map((source) => [source.id, source]));
      const windowsByHandle = new Map(nativeWindows.map((item) => [item.id.split(":")[1], item]));
      const displays = new Map(screen.getAllDisplays().map((display) => [String(display.id), display]));
      this.previewSources = new Map(list.map((source) => [source.id, { ...source, thumbnail: nativeImage.createEmpty() }]));
      this.previewPids = new Map(nativeWindows.map((source) => [source.id.split(":")[1]!, source.pid]));
      this.cached = list
         .filter(
            (s) =>
               s.id.split(":")[1] !== this.ownWindow() &&
               (!["win32", "linux"].includes(process.platform) || s.id.startsWith("screen:") || windowsByHandle.has(s.id.split(":")[1]))
         )
         .map((s) => {
            const display = displays.get(s.display_id);
            let bounds = display?.bounds;
            if (display && process.platform === "win32") bounds = screen.dipToScreenRect(null, display.bounds);
            else if (display && process.platform === "linux")
               bounds = {
                  ...display.nativeOrigin,
                  width: Math.round(display.size.width * display.scaleFactor),
                  height: Math.round(display.size.height * display.scaleFactor),
               };
            const candidate = windowsByHandle.get(s.id.split(":")[1]);
            const prior = previous.get(s.id);
            let applicationId: string | undefined;
            if (s.id.startsWith("window:")) {
               if (candidate?.executable)
                  applicationId = createHash("sha256")
                     .update(process.platform === "win32" ? candidate.executable.toLowerCase() : candidate.executable)
                     .digest("hex");
               else if (candidate && prior?.processId === candidate.pid) applicationId = prior.applicationId;
               applicationId ??= createHash("sha256").update(`window:${s.id}:${randomUUID()}`).digest("hex");
            }
            let appIcon: string | undefined = applicationId ? this.stableWindowIcons.get(applicationId) : undefined;
            if (!appIcon && candidate && prior?.processId === candidate.pid && prior?.applicationId === applicationId) appIcon = prior.appIcon;
            try {
               if (applicationId && !appIcon && s.appIcon && !s.appIcon.isEmpty()) {
                  const value = s.appIcon.resize({ width: 32, height: 32 }).toDataURL();
                  if (value.length <= 45000) {
                     appIcon = value;
                     if (applicationId) this.stableWindowIcons.set(applicationId, value);
                     while (this.stableWindowIcons.size > 128) this.stableWindowIcons.delete(this.stableWindowIcons.keys().next().value!);
                  }
               }
            } catch {
               /* A missing app icon must not make its capture source unavailable. */
            }
            const thumbnail =
               prior &&
               prior.processId === candidate?.pid &&
               prior.applicationId === applicationId &&
               prior.displayId === (s.display_id || undefined) &&
               Date.now() - (this.thumbnailAt.get(s.id) ?? 0) < 60_000
                  ? prior.thumbnail
                  : s.thumbnail.toDataURL();
            return {
               ...(applicationId ? { applicationId } : {}),
               ...(candidate?.executable ? { applicationName: candidate.gameName ?? executableLabel(candidate.executable) } : {}),
               ...(appIcon ? { appIcon } : {}),
               id: s.id,
               name: s.id.startsWith("screen:") && /^entire screen$/i.test(s.name.trim()) ? "Desktop" : s.name,
               kind: s.id.startsWith("screen:") ? "screen" : "app",
               thumbnail,
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
      for (const id of this.thumbnailAt.keys())
         if (!this.cached.some((source) => source.id === id) || Date.now() - this.thumbnailAt.get(id)! >= 60_000) this.thumbnailAt.delete(id);
      if (this.cached.some((source) => source.appIcon && source.appIcon !== previous.get(source.id)?.appIcon)) this.onChange(this.cached);
      if (process.platform === "win32" || process.platform === "darwin") this.hydrateIcons(nativeWindows);
      this.hydrateNames(nativeWindows);
      return this.cached;
   }
   private hydrateNames(candidates: GameCandidate[]): void {
      void Promise.all(
         candidates
            .filter((candidate) => candidate.executable)
            .map(
               async (candidate) =>
                  [
                     createHash("sha256")
                        .update(process.platform === "win32" ? candidate.executable.toLowerCase() : candidate.executable)
                        .digest("hex"),
                     candidate.gameName ?? (await applicationLabel(candidate.executable)),
                  ] as const
            )
      ).then((entries) => {
         const names = new Map(entries);
         let changed = false;
         this.cached = this.cached.map((source) => {
            const name = source.applicationId ? names.get(source.applicationId) : undefined;
            if (!name || name === source.applicationName) return source;
            changed = true;
            return { ...source, applicationName: name };
         });
         if (changed) this.onChange(this.cached);
      });
   }
   private async loadThumbnails(): Promise<CaptureSource[]> {
      if (this.cached.some((source) => source.id.startsWith("portal:")) || isWaylandSession()) return this.cached;
      const snapshot = new Map(this.cached.map((source) => [source.id, source]));
      const frames = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      const images = new Map(frames.map((source) => [source.id, source]));
      this.cached = this.cached.map((source) => {
         const before = snapshot.get(source.id);
         const image = images.get(source.id);
         if (
            !image ||
            !before ||
            before.processId !== source.processId ||
            before.applicationId !== source.applicationId ||
            (source.kind === "screen" && image.display_id !== source.displayId)
         )
            return source;
         this.thumbnailAt.set(source.id, Date.now());
         return { ...source, thumbnail: image.thumbnail.toDataURL() };
      });
      this.onChange(this.cached);
      return this.cached;
   }
   private hydrateIcons(candidates: GameCandidate[]): void {
      const missingIcons = new Map(this.cached.filter((source) => source.kind === "app").map((source) => [source.id.split(":")[1], source.processId]));
      const pending = candidates.filter((candidate) => candidate.executable && missingIcons.get(candidate.id.split(":")[1]) === candidate.pid);
      void Promise.all(
         pending.map(async (candidate) => {
            const executable = process.platform === "win32" ? candidate.executable.toLowerCase() : candidate.executable;
            let icon = this.icons.get(executable);
            if (!icon) {
               icon = app
                  .getFileIcon(process.platform === "darwin" ? candidate.executable.replace(/(\.app)\/Contents\/.*/, "$1") : candidate.executable, {
                     size: "normal",
                  })
                  .then(async (image) => {
                     if (image.isEmpty()) return undefined;
                     const value = image.resize({ width: 32, height: 32 }).toDataURL();
                     if (process.platform === "win32") {
                        this.genericIcon ??= app
                           .getFileIcon(join(tmpdir(), `.acroclip-generic-${randomUUID()}.exe`), { size: "normal" })
                           .then((generic) => (generic.isEmpty() ? undefined : generic.resize({ width: 32, height: 32 }).toDataURL()))
                           .catch(() => undefined);
                        if (value === (await this.genericIcon)) return undefined;
                     }
                     return value.length <= 45000 ? value : undefined;
                  })
                  .catch(() => undefined);
               this.icons.set(executable, icon);
               void icon.then((value) => {
                  if (!value) {
                     const timer = setTimeout(() => this.icons.delete(executable), 30_000);
                     timer.unref();
                  }
               });
               while (this.icons.size > 128) this.icons.delete(this.icons.keys().next().value!);
            }
            return [createHash("sha256").update(executable).digest("hex"), await icon] as const;
         })
      ).then(async (entries) => {
         const icons = new Map(entries);
         let changed = false;
         this.cached = this.cached.map((source) => {
            const appIcon = source.applicationId ? icons.get(source.applicationId) : undefined;
            if (!appIcon || source.appIcon === appIcon) return source;
            this.stableWindowIcons.set(source.applicationId!, appIcon);
            while (this.stableWindowIcons.size > 128) this.stableWindowIcons.delete(this.stableWindowIcons.keys().next().value!);
            changed = true;
            return { ...source, appIcon };
         });
         if (changed) this.onChange(this.cached);
      });
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
