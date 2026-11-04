import { constants } from "node:fs";
import type { BigIntStats } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { storeApplicationArtwork, readApplicationArtwork } from "./application-icons";
import type { ApplicationArtwork } from "../shared/types";
import type { Category, Clip, FolderContents, Job, Shareable } from "../shared/types";
import { collectionFolder, folderContents, folderName } from "./collection-folders";
import { normalizeApplicationLabel } from "./application-identity";
import { createThumbnail, encodeShareable, probe } from "./media";
import type { MediaInfo } from "./media";
import { PlaybackCache } from "./playback";
import { mapConcurrent } from "./concurrent";

const categorySchema = z.object({ id: z.string(), name: z.string(), color: z.string(), icon: z.string().max(80).optional() });
const thumbnailName = (identity: string) => `${identity}.last-keyframe-v1.jpg`;
const fileSchema = z.object({ relativePath: z.string(), absolutePath: z.string(), identity: z.string() });
const shareSchema = fileSchema.extend({ id: z.string(), size: z.number().nonnegative(), targetMB: z.number().positive(), createdAt: z.number() });
const previewSchema = z.object({
   stamp: z.string(),
   size: z.number().nonnegative(),
   info: z.object({
      duration: z.number().nonnegative(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
      frameRate: z.number().positive(),
      videoCodec: z.string(),
      tracks: z.array(z.object({ index: z.number(), title: z.string(), codec: z.string() })),
   }),
});
const clipSchema = fileSchema.extend({
   preview: previewSchema.optional().catch(undefined),
   previewUnavailable: z.boolean().optional(),
   application: z.object({ id: z.string().max(512), name: z.string().max(256).optional(), iconFile: z.string().max(4096).optional() }).optional(),
   id: z.string(),
   name: z.string(),
   source: z.string(),
   createdAt: z.number(),
   categories: z.array(z.string()),
   shareables: z.array(shareSchema),
});
const metadataSchema = z
   .object({ version: z.literal(1), collectionId: z.string(), categories: z.array(categorySchema), clips: z.array(clipSchema) })
   .superRefine((metadata, context) => {
      const unique = (ids: string[], path: (string | number)[]) => {
         if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path, message: "Collection action identities must be unique." });
      };
      unique(
         metadata.clips.map((clip) => clip.id),
         ["clips"]
      );
      unique(
         metadata.categories.map((category) => category.id),
         ["categories"]
      );
      for (const [index, clip] of metadata.clips.entries())
         unique(
            clip.shareables.map((share) => share.id),
            ["clips", index, "shareables"]
         );
   });
type Metadata = z.infer<typeof metadataSchema>;
type StoredClip = Metadata["clips"][number];
type StoredFile = z.infer<typeof fileSchema>;
const supported = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".ts", ".flv"]);
const normal = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
export function withinRoot(root: string, path: string): boolean {
   const rel = relative(normal(resolve(root)), normal(resolve(path)));
   return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const safeRelative = (path: string) => !isAbsolute(path) && !path.split(/[\\/]/).includes("..");
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fileStamp = (value: BigIntStats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.birthtimeNs}`;

async function publishWithoutOverwrite(source: string, destination: string): Promise<void> {
   try {
      await link(source, destination);
   } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["ENOTSUP", "ENOSYS", "EPERM", "EXDEV"].includes(code ?? "")) throw error;
      // Removable drives may not support hard links. Exclusive copy still protects existing files.
      await copyFile(source, destination, constants.COPYFILE_EXCL);
   }
}

/** Sampled identity is for recovery, not security or duplicate deletion. */
export async function fileIdentity(path: string): Promise<string> {
   const handle = await open(path, "r");
   try {
      const size = (await handle.stat()).size;
      const hash = createHash("sha256").update(String(size));
      for (const position of new Set([0, Math.max(0, size - 65536)])) {
         const buffer = Buffer.alloc(Math.min(size, 65536));
         const result = await handle.read(buffer, 0, buffer.length, position);
         hash.update(buffer.subarray(0, result.bytesRead));
      }
      return hash.digest("hex");
   } finally {
      await handle.close();
   }
}

export interface CollectionOptions {
   applications?: () => ApplicationArtwork[];
   beforeFolderChange?: () => void;
   onChange?: () => void;
   onJob?: (job: Job) => void;
   onWarning?: (message: string) => void;
   mediaUrl?: (path: string) => string;
   scanConcurrency?: () => number;
}
export class CollectionService {
   root = "";
   phase: "loading" | "refreshing" | "ready" | "error" = "loading";
   scanError = "";
   discovery: { videos: number; byFolder: Record<string, number>; complete: boolean } | undefined;
   private scanned = false;
   private opening = false;
   private readonly playbackCache = new PlaybackCache();
   private playbackLifetime = new AbortController();
   private artworkCache = new Map<string, string>();
   clips: Clip[] = [];
   folders: string[] = [];
   applicationIcons: Record<string, string> = {};
   jobs: Job[] = [];
   warnings: string[] = [];
   private options: CollectionOptions;
   private metadata: Metadata = { version: 1, collectionId: randomUUID(), categories: [], clips: [] };
   private controllers = new Map<string, AbortController>();
   private queue: Promise<void> = Promise.resolve();
   private writes: Promise<void> = Promise.resolve();
   private scanRunning: Promise<Clip[]> | undefined;
   private refreshRunning: Promise<Clip[]> | undefined;
   private registeringSources = new Map<string, string>();
   private changeStamp: string | undefined;
   private scanRetryNeeded = false;
   private metadataWritable = true;
   private fileChanges: Promise<void> = Promise.resolve();
   private fileMutation: Promise<void> | undefined;
   private cache = new Map<string, { stamp: string; info: MediaInfo; thumbnail: string }>();
   // Scanning may reuse sampled identities. Export, rename and deletion always
   // read a fresh identity through resolveFile instead of trusting this cache.
   private identities = new Map<string, { stamp: string; identity: string }>();
   private writtenMetadata: { snapshot: string; stamp: string } | undefined;
   constructor(options: CollectionOptions = {}) {
      this.options = options;
   }
   get categories(): Category[] {
      return this.metadata.categories;
   }
   async enrichApplications(artworks: ApplicationArtwork[]): Promise<void> {
      if (this.opening || !this.scanned || !this.metadataWritable) return;
      await this.fileChanges;
      if (this.scanRunning) await this.scanRunning;
      const root = this.root;
      let changed = false;
      for (const art of artworks) {
         const clips = this.metadata.clips.filter((clip) => clip.application?.id === art.id);
         if (
            !clips.length ||
            (clips.every((clip) => !art.name || clip.application?.name === art.name) && (!art.icon || this.applicationIcons[art.id] === art.icon))
         )
            continue;
         const saved = await storeApplicationArtwork(root, art);
         if (this.root !== root || !saved) return;
         for (const clip of clips) clip.application = { ...clip.application!, ...saved };
         this.clips = this.clips.map((clip) => (clip.applicationId === art.id && art.name ? { ...clip, source: art.name } : clip));
         if (saved.iconFile) this.applicationIcons = { ...this.applicationIcons, [art.id]: art.icon };
         changed = true;
      }
      if (changed) {
         await this.writeMetadata();
         this.notify();
      }
   }
   get pendingJobs(): Job[] {
      return this.jobs.filter((job) => job.state === "queued" || job.state === "running");
   }
   finishFileChanges(): Promise<void> {
      return this.fileChanges;
   }
   private notify() {
      this.options.onChange?.();
   }
   private warn(text: string) {
      if (!this.warnings.includes(text)) {
         this.warnings.push(text);
         this.options.onWarning?.(text);
      }
   }
   private url(path: string) {
      return this.options.mediaUrl?.(path) ?? pathToFileURL(path).href;
   }
   private metaPath() {
      return join(this.root, ".acroclip", "collection.json");
   }

   async open(root: string): Promise<void> {
      this.opening = true;
      try {
         await this.openCollection(root);
      } catch (error) {
         this.phase = "error";
         this.scanError = message(error);
         this.notify();
         throw error;
      } finally {
         this.opening = false;
      }
      await this.enrichApplications(this.options.applications?.() ?? []);
   }
   private async openCollection(root: string): Promise<void> {
      await this.fileChanges;
      if (this.pendingJobs.length) throw new Error("Finish or cancel shareable creation before changing folders.");
      if (this.refreshRunning) await this.refreshRunning.catch(() => undefined);
      if (this.scanRunning) await this.scanRunning;
      await this.writes;
      await mkdir(resolve(root), { recursive: true });
      const nextRoot = await realpath(resolve(root));
      this.playbackLifetime.abort();
      this.playbackLifetime = new AbortController();
      this.root = nextRoot;
      await this.safeDirectory(join(this.root, ".acroclip"));
      this.playbackCache.cancelAll();
      this.cache.clear();
      this.identities.clear();
      this.writtenMetadata = undefined;
      this.warnings = [];
      this.clips = [];
      this.folders = [];
      this.applicationIcons = {};
      this.artworkCache.clear();
      this.scanned = false;
      this.changeStamp = undefined;
      this.discovery = undefined;
      this.phase = "loading";
      this.scanError = "";
      this.metadataWritable = true;
      this.metadata = { version: 1, collectionId: randomUUID(), clips: [], categories: [] };
      this.notify();
      let broken = false;
      for (const path of [this.metaPath(), `${this.metaPath()}.bak`]) {
         try {
            this.metadata = metadataSchema.parse(JSON.parse(await readFile(path, "utf8")));
            if (path === this.metaPath())
               this.writtenMetadata = {
                  snapshot: JSON.stringify(this.metadata, null, 2),
                  stamp: fileStamp(await stat(path, { bigint: true })),
               };
            if (broken) this.warn("Collection metadata was recovered from its backup.");
            broken = false;
            break;
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") broken = true;
         }
      }
      if (broken) {
         this.metadataWritable = false;
         this.warn("Collection metadata is damaged. Videos remain available, but tags and shareable changes are disabled to preserve recovery information.");
      }
      // Render the collection's own indexed previews before touching the video files.
      let previewsSafe = true;
      let thumbnailFiles = new Set<string>();
      try {
         await this.safeDirectory(join(this.root, ".acroclip", "thumbnails"));
         thumbnailFiles = new Set(
            (await readdir(join(this.root, ".acroclip", "thumbnails"), { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
         );
      } catch {
         previewsSafe = false;
      }
      this.clips = previewsSafe
         ? this.metadata.clips.flatMap((stored) => {
              const clip = this.previewClip(stored, thumbnailFiles);
              return clip ? [clip] : [];
           })
         : [];
      this.notify();
      await this.scan();
   }

   private previewClip(stored: StoredClip, thumbnailFiles: ReadonlySet<string>): Clip | undefined {
      if (stored.previewUnavailable || !safeRelative(stored.relativePath) || !/^[a-f0-9]{64}$/i.test(stored.identity)) return;
      const path = resolve(this.root, stored.relativePath);
      if (!withinRoot(this.root, path)) return;
      const shares: Shareable[] = stored.shareables
         .filter((share) => safeRelative(share.relativePath) && withinRoot(this.root, resolve(this.root, share.relativePath)))
         .map((share) => ({
            id: share.id,
            path: resolve(this.root, share.relativePath),
            relativePath: share.relativePath,
            size: share.size,
            targetMB: share.targetMB,
            createdAt: share.createdAt,
         }));
      return {
         id: stored.id,
         path,
         relativePath: stored.relativePath,
         name: stored.name,
         source: normalizeApplicationLabel(stored.application?.name ?? stored.source),
         createdAt: stored.createdAt,
         ...(stored.application ? { applicationId: stored.application.id } : {}),
         size: stored.preview?.size ?? 0,
         duration: stored.preview?.info.duration ?? 0,
         width: stored.preview?.info.width ?? 0,
         height: stored.preview?.info.height ?? 0,
         tracks: stored.preview?.info.tracks ?? [],
         thumbnail: thumbnailFiles.has(thumbnailName(stored.identity))
            ? this.url(join(this.root, ".acroclip", "thumbnails", thumbnailName(stored.identity)))
            : thumbnailFiles.has(`${stored.identity}.jpg`)
              ? this.url(join(this.root, ".acroclip", "thumbnails", `${stored.identity}.jpg`))
              : "",
         playbackUrl: this.url(path),
         categories: [...stored.categories],
         shareables: shares,
         availability: "unverified",
      };
   }

   private async safeDirectory(path: string): Promise<void> {
      if (!withinRoot(this.root, path)) throw new Error("The folder is outside this collection.");
      let existing = path;
      while (true) {
         try {
            const actual = await realpath(existing);
            if (!withinRoot(this.root, actual)) throw new Error("A collection folder points outside the collection.");
            break;
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            const parent = dirname(existing);
            if (parent === existing) throw error;
            existing = parent;
         }
      }
      await mkdir(path, { recursive: true });
      if (!withinRoot(this.root, await realpath(path))) throw new Error("The folder points outside this collection.");
   }

   private async writeMetadata(): Promise<void> {
      if (!this.metadataWritable) throw new Error("Collection metadata needs recovery before making this change.");
      const snapshot = JSON.stringify(this.metadata, null, 2);
      const path = this.metaPath();
      const write = this.writes
         .catch(() => undefined)
         .then(async () => {
            if (this.writtenMetadata?.snapshot === snapshot) {
               try {
                  if (this.writtenMetadata.stamp === fileStamp(await stat(path, { bigint: true }))) return;
               } catch {
                  /* Recreate a missing metadata file safely. */
               }
            }
            await this.safeDirectory(dirname(path));
            const temporary = `${path}.${randomUUID()}.tmp`;
            try {
               const handle = await open(temporary, "wx");
               try {
                  await handle.writeFile(snapshot);
                  await handle.sync();
               } finally {
                  await handle.close();
               }
               // Never rotate a damaged primary over the known-good recovery copy.
               try {
                  metadataSchema.parse(JSON.parse(await readFile(path, "utf8")));
                  await copyFile(path, `${path}.bak`);
               } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
               }
               await rename(temporary, path);
               this.writtenMetadata = { snapshot, stamp: fileStamp(await stat(path, { bigint: true })) };
            } finally {
               await rm(temporary, { force: true });
            }
         });
      this.writes = write;
      await write;
   }

   private async scanIdentity(path: string, stamp?: BigIntStats): Promise<string> {
      const key = fileStamp(stamp ?? (await stat(path, { bigint: true })));
      const previous = this.identities.get(path);
      if (previous?.stamp === key) return previous.identity;
      const identity = await fileIdentity(path);
      // A changing file must not retain an identity under its earlier stamp.
      if (fileStamp(await stat(path, { bigint: true })) === key) this.identities.set(path, { stamp: key, identity });
      else this.identities.delete(path);
      return identity;
   }

   private async cachedMedia(actual: string, identity: string, fileStat: BigIntStats, preview?: z.infer<typeof previewSchema>) {
      const stamp = fileStamp(fileStat);
      let cached = this.cache.get(actual);
      if (!cached || cached.stamp !== stamp) {
         const info = preview?.stamp === stamp ? preview.info : await probe(actual);
         let thumb = join(this.root, ".acroclip", "thumbnails", thumbnailName(identity));
         try {
            await this.safeDirectory(dirname(thumb));
            try {
               const image = await lstat(thumb);
               if (!image.isFile() || image.size === 0) throw new Error("Thumbnail cache is incomplete.");
            } catch {
               const temporary = `${thumb}.${randomUUID()}.jpg`;
               try {
                  await createThumbnail(actual, temporary, info.duration);
                  await rename(temporary, thumb);
                  await rm(join(this.root, ".acroclip", "thumbnails", `${identity}.jpg`), { force: true }).catch(() => undefined);
               } finally {
                  await rm(temporary, { force: true });
               }
            }
         } catch (error) {
            this.warn(`Preview thumbnail unavailable for ${basename(actual)}: ${message(error)}`);
            const legacy = join(this.root, ".acroclip", "thumbnails", `${identity}.jpg`);
            const image = await lstat(legacy).catch(() => undefined);
            thumb = image?.isFile() && image.size > 0 ? legacy : "";
         }
         cached = { stamp, info, thumbnail: thumb };
         this.cache.set(actual, cached);
      }
      return cached;
   }

   private async resolveFile(file: StoredFile, scanning = false): Promise<string | undefined> {
      const identity = (path: string) => (scanning ? this.scanIdentity(path) : fileIdentity(path));
      if (safeRelative(file.relativePath)) {
         const path = resolve(this.root, file.relativePath);
         try {
            const actual = await realpath(path);
            if (withinRoot(this.root, actual) && (await identity(actual)) === file.identity) return actual;
         } catch (error) {
            if (scanning && !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            /* Try verified recovery below. */
         }
      }
      try {
         const actual = await realpath(file.absolutePath);
         if ((await identity(actual)) !== file.identity) return undefined;
         if (!withinRoot(this.root, actual)) {
            this.warn("A missing video was found outside this collection. Relink or copy it into this folder before using it here.");
            return undefined;
         }
         file.relativePath = relative(this.root, actual);
         file.absolutePath = actual;
         return actual;
      } catch (error) {
         if (scanning && !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
         return undefined;
      }
   }

   private async shareablesOwned(): Promise<boolean> {
      try {
         const marker: unknown = JSON.parse(await readFile(join(this.root, "shareables", ".acroclip-owner.json"), "utf8"));
         return typeof marker === "object" && marker !== null && "collectionId" in marker && marker.collectionId === this.metadata.collectionId;
      } catch {
         return false;
      }
   }

   // Poll file metadata only. Reading media, generating previews and publishing
   // refresh state belong to scan(), and only run after something changes.
   refresh(): Promise<Clip[]> {
      if (this.scanRunning) return this.scanRunning;
      if (this.refreshRunning) return this.refreshRunning;
      if (this.opening || !this.root) return Promise.resolve(this.clips);
      this.refreshRunning = (async () => {
         try {
            const [stamp, metadataCurrent] = await Promise.all([this.collectionStamp(), this.metadataCurrent()]);
            if (this.phase === "ready" && stamp === this.changeStamp && metadataCurrent) return this.clips;
            return await this.scan();
         } catch (error) {
            const text = message(error);
            if (this.phase !== "error" || this.scanError !== text) {
               this.phase = "error";
               this.scanError = text;
               this.notify();
            }
            throw error;
         }
      })().finally(() => {
         this.refreshRunning = undefined;
      });
      return this.refreshRunning;
   }
   private async metadataCurrent(): Promise<boolean> {
      if (!this.metadataWritable) return true;
      try {
         return this.writtenMetadata?.stamp === fileStamp(await stat(this.metaPath(), { bigint: true }));
      } catch (error) {
         if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
         return false;
      }
   }
   private async collectionStamp(): Promise<string> {
      if (!this.root) return "";
      const hash = createHash("sha256");
      const ownedShares = await this.shareablesOwned();
      const registeredPaths = new Set(this.metadata.clips.map((clip) => normal(resolve(this.root, clip.relativePath))));
      const fileRecord = async (path: string): Promise<string> => {
         try {
            return JSON.stringify([relative(this.root, path), fileStamp(await stat(path, { bigint: true }))]);
         } catch (error) {
            if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            return JSON.stringify([relative(this.root, path), "missing"]);
         }
      };
      const walk = async (directory: string): Promise<void> => {
         if (!withinRoot(this.root, await realpath(directory))) return;
         hash.update(JSON.stringify([relative(this.root, directory), fileStamp(await stat(directory, { bigint: true }))]));
         const entries = await readdir(directory, { withFileTypes: true });
         entries.sort((a, b) => a.name.localeCompare(b.name));
         const records = await mapConcurrent(entries, 4, async (entry) => {
            if (!entry.isFile() || !supported.has(extname(entry.name).toLowerCase()) || entry.name.startsWith(".acroclip-")) return;
            const path = join(directory, entry.name);
            if (/\.mkv\.saving\.mkv$/i.test(entry.name) && !registeredPaths.has(normal(path))) return;
            return fileRecord(path);
         });
         for (const [index, entry] of entries.entries()) {
            if (entry.isSymbolicLink() || entry.name === ".acroclip") continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
               if (directory === this.root && entry.name === "shareables" && ownedShares) continue;
               try {
                  await walk(path);
               } catch (error) {
                  if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
                  hash.update(JSON.stringify([relative(this.root, path), "missing"]));
               }
            } else if (records[index]) hash.update(records[index]);
         }
      };
      await walk(this.root);
      // Owned shareables are excluded from discovery, but changes to registered
      // files still need to update their original clip's available exports.
      const shares = [...new Set(this.metadata.clips.flatMap((clip) => clip.shareables.map((share) => share.relativePath)))].sort();
      const records = await mapConcurrent(shares, 4, async (path) => {
         if (!safeRelative(path)) return;
         const full = resolve(this.root, path);
         return withinRoot(this.root, full) ? fileRecord(full) : undefined;
      });
      for (const record of records) if (record) hash.update(record);
      return hash.digest("hex");
   }
   private async scanWithStamp(): Promise<Clip[]> {
      // Snapshot before scanning so edits arriving during a scan trigger the
      // next poll instead of becoming an unchecked baseline.
      const stamp = await this.collectionStamp();
      const clips = await this.scanCollection();
      this.changeStamp = this.scanRetryNeeded ? undefined : stamp;
      return clips;
   }
   scan(): Promise<Clip[]> {
      if (this.fileMutation) return this.fileMutation.then(() => this.scan());
      if (this.scanRunning) return this.scanRunning;
      this.phase = this.scanned ? "refreshing" : "loading";
      this.scanError = "";
      this.scanRunning = this.scanWithStamp()
         .then(
            (clips) => {
               this.scanned = true;
               this.phase = "ready";
               return clips;
            },
            (error: unknown) => {
               this.phase = "error";
               this.scanError = message(error);
               throw error;
            }
         )
         .finally(() => {
            this.scanRunning = undefined;
            this.notify();
         });
      this.notify();
      return this.scanRunning;
   }
   private async scanCollection(): Promise<Clip[]> {
      if (!this.root) return [];
      this.scanRetryNeeded = false;
      const files: string[] = [];
      const folders: string[] = [];
      const ownedShares = await this.shareablesOwned();
      const counts: Record<string, number> = {};
      let discoveryPublishedAt = 0;
      const publishDiscovery = (complete: boolean) => {
         if (this.scanned) return;
         if (!complete && Date.now() - discoveryPublishedAt < 50) return;
         discoveryPublishedAt = Date.now();
         this.discovery = { videos: files.length, byFolder: { ...counts }, complete };
         this.folders = [...folders].sort((a, b) => a.localeCompare(b));
         this.notify();
      };
      const walk = async (directory: string): Promise<void> => {
         const entries = await (async () => {
            try {
               if (!withinRoot(this.root, await realpath(directory))) return [];
               const children = await readdir(directory, { withFileTypes: true });
               if (directory !== this.root) folders.push(relative(this.root, directory).replaceAll("\\", "/"));
               return children;
            } catch (error) {
               if (directory === this.root || !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
               return [];
            }
         })();
         const directories: string[] = [];
         const key = relative(this.root, directory).replaceAll("\\", "/");
         counts[key] = 0;
         for (const entry of entries) {
            if (entry.isSymbolicLink() || entry.name === ".acroclip") continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
               if (directory === this.root && entry.name === "shareables" && ownedShares) continue;
               directories.push(path);
            } else if (entry.isFile() && supported.has(extname(entry.name).toLowerCase()) && !entry.name.startsWith(".acroclip-")) {
               if (/\.mkv\.saving\.mkv$/i.test(entry.name)) {
                  const stored = this.metadata.clips.find(
                     (clip) => safeRelative(clip.relativePath) && normal(resolve(this.root, clip.relativePath)) === normal(path)
                  );
                  if (!stored) continue;
                  const completed = await this.resolveFile(stored, true);
                  if (!completed || normal(completed) !== normal(await realpath(path))) continue;
               }
               files.push(path);
               counts[key] = (counts[key] ?? 0) + 1;
            }
         }
         publishDiscovery(false);
         for (const child of directories) await walk(child);
      };
      await walk(this.root);
      publishDiscovery(true);
      const result: Clip[] = [];
      const used = new Set<string>();
      const retainedPaths = new Set<string>();
      const currentRelativePaths = new Set(files.map((file) => relative(this.root, file)));
      const byPath = new Map<string, StoredClip[]>();
      const byIdentity = new Map<string, StoredClip[]>();
      for (const clip of this.metadata.clips) {
         const paths = byPath.get(clip.relativePath) ?? [];
         paths.push(clip);
         byPath.set(clip.relativePath, paths);
         const identities = byIdentity.get(clip.identity) ?? [];
         identities.push(clip);
         byIdentity.set(clip.identity, identities);
      }
      const prior = this.clips;
      let publishedAt = 0;
      const publishProgress = () => {
         if (this.scanned || !result.length || Date.now() - publishedAt < 150) return;
         publishedAt = Date.now();
         const ids = new Set(result.map((clip) => clip.id)),
            paths = new Set(result.map((clip) => normal(clip.path)));
         this.clips = [...result, ...prior.filter((clip) => !ids.has(clip.id) && !paths.has(normal(clip.path)))].sort(
            (a, b) => b.createdAt - a.createdAt || a.relativePath.localeCompare(b.relativePath)
         );
         this.notify();
      };
      let cursor = 0;
      const concurrencyLimit = () => Math.max(1, Math.min(3, this.options.scanConcurrency?.() ?? 1));
      const readNext = async (worker: number) => {
         while (cursor < files.length) {
            if (worker >= concurrencyLimit()) return;
            const path = files[cursor++]!;
            try {
               const actual = await realpath(path);
               if (!withinRoot(this.root, actual)) continue;
               const fileStat = await stat(actual, { bigint: true });
               const identity = await this.scanIdentity(actual, fileStat);
               retainedPaths.add(actual);
               const rel = relative(this.root, actual);
               let stored = byPath.get(rel)?.find((clip) => clip.identity === identity && !used.has(clip.id));
               stored ??= byIdentity.get(identity)?.find((clip) => !used.has(clip.id) && !currentRelativePaths.has(clip.relativePath));
               if (!stored) {
                  stored = {
                     id: randomUUID(),
                     relativePath: rel,
                     absolutePath: actual,
                     identity,
                     name: basename(actual, extname(actual)),
                     source: "Unknown",
                     createdAt: Number(fileStat.birthtimeMs || fileStat.mtimeMs),
                     categories: [],
                     shareables: [],
                  };
                  this.metadata.clips.push(stored);
               }
               used.add(stored.id);
               stored.relativePath = rel;
               stored.absolutePath = actual;
               const cached = await this.cachedMedia(actual, identity, fileStat, stored.preview);
               stored.previewUnavailable = undefined;
               stored.preview = { stamp: fileStamp(fileStat), size: Number(fileStat.size), info: cached.info };
               const recordingSource = this.registeringSources.get(normal(actual));
               if (recordingSource !== undefined) stored.source = recordingSource;
               const shares: Shareable[] = [];
               for (const share of stored.shareables) {
                  const located = await this.resolveFile(share, true);
                  if (located) {
                     retainedPaths.add(located);
                     shares.push({
                        id: share.id,
                        path: located,
                        relativePath: share.relativePath,
                        size: (await stat(located)).size,
                        targetMB: share.targetMB,
                        createdAt: share.createdAt,
                     });
                  }
               }
               result.push({
                  id: stored.id,
                  path: actual,
                  relativePath: rel,
                  name: stored.name,
                  source: normalizeApplicationLabel(stored.application?.name ?? stored.source),
                  ...(stored.application ? { applicationId: stored.application.id } : {}),
                  size: Number(fileStat.size),
                  duration: cached.info.duration,
                  width: cached.info.width,
                  height: cached.info.height,
                  createdAt: stored.createdAt,
                  thumbnail: cached.thumbnail ? this.url(cached.thumbnail) : "",
                  playbackUrl: this.url(actual),
                  tracks: cached.info.tracks,
                  categories: [...stored.categories],
                  shareables: shares,
               });
            } catch (error) {
               this.scanRetryNeeded = true;
               const previous = this.clips.find((clip) => normal(clip.path) === normal(path));
               if (previous) {
                  result.push({ ...previous, availability: "unverified" });
                  used.add(previous.id);
               }
               this.warn(`Could not read ${basename(path)}: ${message(error)}`);
            }
            publishProgress();
         }
      };
      await Promise.all(Array.from({ length: concurrencyLimit() }, (_, worker) => readNext(worker)));
      // Keep verified shareables reachable when their original disappears.
      // Their original record and associations remain intact for recovery.
      for (const stored of this.metadata.clips.filter((clip) => !used.has(clip.id))) {
         try {
            const original = await this.resolveFile(stored, true);
            const originalPath = original ?? resolve(this.root, stored.relativePath);
            if (!safeRelative(stored.relativePath) || !withinRoot(this.root, originalPath)) continue;
            const shares: Shareable[] = [];
            for (const share of stored.shareables) {
               const located = await this.resolveFile(share, true);
               if (!located) continue;
               retainedPaths.add(located);
               shares.push({
                  id: share.id,
                  path: located,
                  relativePath: share.relativePath,
                  size: (await stat(located)).size,
                  targetMB: share.targetMB,
                  createdAt: share.createdAt,
               });
            }
            const available = original ?? shares[0]?.path;
            if (!available) {
               stored.preview = undefined;
               stored.previewUnavailable = true;
               continue;
            }
            const actualStat = await stat(available, { bigint: true });
            const identity = await this.scanIdentity(available, actualStat);
            const cached = await this.cachedMedia(available, identity, actualStat);
            retainedPaths.add(available);
            used.add(stored.id);
            result.push({
               id: stored.id,
               path: originalPath,
               relativePath: stored.relativePath,
               name: stored.name,
               source: normalizeApplicationLabel(stored.application?.name ?? stored.source),
               ...(stored.application ? { applicationId: stored.application.id } : {}),
               size: original ? Number(actualStat.size) : 0,
               duration: cached.info.duration,
               width: cached.info.width,
               height: cached.info.height,
               createdAt: stored.createdAt,
               thumbnail: cached.thumbnail ? this.url(cached.thumbnail) : "",
               playbackUrl: original ? this.url(original) : "",
               tracks: cached.info.tracks,
               categories: [...stored.categories],
               shareables: shares,
               ...(!original ? { originalMissing: true } : {}),
            });
         } catch (error) {
            this.scanRetryNeeded = true;
            const previous = this.clips.find((clip) => clip.id === stored.id);
            if (previous) result.push({ ...previous, availability: "unverified" });
            this.warn(`Could not open retained shareables for ${stored.name}: ${message(error)}`);
         }
      }
      const artwork = new Map<string, string>();
      const visibleIds = new Set(result.map((clip) => clip.id));
      const iconReads = new Map<string, Promise<string | undefined>>();
      for (const stored of this.metadata.clips)
         if (stored.application?.iconFile && visibleIds.has(stored.id)) {
            const file = stored.application.iconFile;
            let pending = iconReads.get(file);
            if (!pending) {
               if (iconReads.size >= 512) continue;
               const cached = this.artworkCache.get(file);
               pending = cached
                  ? Promise.resolve(cached)
                  : readApplicationArtwork(this.root, stored.application).then((image) => {
                       if (image) {
                          if (this.artworkCache.size >= 512) this.artworkCache.delete(this.artworkCache.keys().next().value!);
                          this.artworkCache.set(file, image);
                       }
                       return image;
                    });
               iconReads.set(file, pending);
            }
            const image = await pending;
            if (image) artwork.set(stored.application.id, image);
         }
      this.applicationIcons = Object.fromEntries(artwork);
      this.folders = folders.sort((a, b) => a.localeCompare(b));
      this.clips = result.sort((a, b) => b.createdAt - a.createdAt || a.relativePath.localeCompare(b.relativePath));
      for (const path of this.identities.keys()) if (!retainedPaths.has(path)) this.identities.delete(path);
      for (const path of this.cache.keys()) if (!retainedPaths.has(path)) this.cache.delete(path);
      if (this.metadataWritable) await this.writeMetadata();
      this.notify();
      return this.clips;
   }

   private stored(id: string): StoredClip {
      const clip = this.metadata.clips.find((entry) => entry.id === id);
      if (!clip) throw new Error("This clip is no longer in the collection.");
      return clip;
   }
   private visible(id: string): Clip {
      const clip = this.clips.find((entry) => entry.id === id);
      if (!clip) throw new Error("This video is missing.");
      return clip;
   }
   private changeFiles<T>(action: () => Promise<T>): Promise<T> {
      const root = this.root;
      const result = this.fileChanges.then(async () => {
         if (root !== this.root || this.opening || !this.scanned) throw new Error("Wait for the collection to finish opening.");
         if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing files.");
         if (this.scanRunning) await this.scanRunning;
         let release!: () => void;
         this.fileMutation = new Promise<void>((resolve) => {
            release = resolve;
         });
         try {
            const value = await action();
            await this.writeMetadata();
            return value;
         } finally {
            this.fileMutation = undefined;
            release();
            await this.scan();
         }
      });
      this.fileChanges = result.then(
         () => undefined,
         () => undefined
      );
      return result;
   }
   private async checkedFolder(path: string, allowRoot = true): Promise<string> {
      const folder = await collectionFolder(this.root, path, allowRoot);
      if (relative(this.root, folder).split(sep)[0]?.toLowerCase() === "shareables" && (await this.shareablesOwned()))
         throw new Error("AcroClip manages this shareables folder. Choose another folder.");
      return folder;
   }
   private checkFolderJobs(): void {
      this.options.beforeFolderChange?.();
      if (this.pendingJobs.length) throw new Error("Finish or cancel shareable exports before changing folders.");
   }
   createFolder(parent: string, name: string): Promise<string> {
      return this.changeFiles(async () => {
         const destination = join(await this.checkedFolder(parent), folderName(name));
         try {
            await mkdir(destination);
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A file or folder with that name already exists.", { cause: error });
            throw error;
         }
         return relative(this.root, destination).replaceAll("\\", "/");
      });
   }
   renameFolder(path: string, name: string): Promise<string> {
      return this.relocateFolder(path, undefined, folderName(name));
   }
   moveFolder(path: string, destination: string, fingerprint?: string): Promise<string> {
      return this.relocateFolder(path, destination, undefined, fingerprint);
   }
   private relocateFolder(path: string, parent?: string, name?: string, fingerprint?: string): Promise<string> {
      return this.changeFiles(async () => {
         this.checkFolderJobs();
         const source = await this.checkedFolder(path, false);
         if (fingerprint && (await folderContents(source, supported)).fingerprint !== fingerprint)
            throw new Error("The folder contents changed. Review the folder and try moving it again.");
         const targetParent = parent === undefined ? dirname(source) : await this.checkedFolder(parent);
         if (withinRoot(source, targetParent)) throw new Error("A folder cannot be moved into itself or one of its subfolders.");
         const destination = join(targetParent, name ?? basename(source));
         if (normal(source) === normal(destination)) return relative(this.root, source).replaceAll("\\", "/");
         try {
            await lstat(destination);
            throw new Error("A file or folder with that name already exists. Choose another name or destination.");
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
         }
         await rename(source, destination);
         for (const clip of this.metadata.clips) {
            for (const file of [clip, ...clip.shareables]) {
               const original = resolve(this.root, file.relativePath);
               if (!withinRoot(source, original)) continue;
               const moved = join(destination, relative(source, original));
               file.relativePath = relative(this.root, moved);
               file.absolutePath = moved;
            }
         }
         return relative(this.root, destination).replaceAll("\\", "/");
      });
   }
   async inspectFolder(path: string): Promise<FolderContents> {
      return folderContents(await this.checkedFolder(path, false), supported);
   }
   trashFolder(path: string, fingerprint: string, trash: (path: string) => Promise<void>): Promise<void> {
      return this.changeFiles(async () => {
         this.checkFolderJobs();
         const directory = await this.checkedFolder(path, false);
         if ((await folderContents(directory, supported)).fingerprint !== fingerprint)
            throw new Error("The folder contents changed. Review the folder and try deleting it again.");
         await trash(directory);
         this.metadata.clips = this.metadata.clips.filter((clip) => {
            clip.shareables = clip.shareables.filter((share) => !withinRoot(directory, resolve(this.root, share.relativePath)));
            return !withinRoot(directory, resolve(this.root, clip.relativePath)) || clip.shareables.length > 0;
         });
      });
   }
   moveClip(id: string, destination: string): Promise<boolean> {
      return this.changeFiles(async () => {
         const target = await this.checkedFolder(destination);
         if (this.pendingJobs.some((job) => job.clipId === id)) throw new Error("Finish or cancel this clip's export before moving it.");
         const stored = this.stored(id);
         const source = await this.resolveFile(stored);
         if (!source) throw new Error("The original video moved or changed. Refresh the library and try again.");
         const moved = join(target, basename(source));
         if (normal(moved) === normal(source)) return false;
         try {
            await publishWithoutOverwrite(source, moved);
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
               throw new Error("A file with this name already exists in the destination.", { cause: error });
            throw error;
         }
         try {
            await rm(source);
         } catch (error) {
            await rm(moved);
            throw error;
         }
         stored.relativePath = relative(this.root, moved);
         stored.absolutePath = moved;
         return true;
      });
   }
   async rename(id: string, name: string): Promise<void> {
      const cleaned = name.trim();
      if (!cleaned || cleaned.length > 200) throw new Error("Choose a clip name between 1 and 200 characters.");
      if (
         /[<>:"/\\|?*]/.test(cleaned) ||
         [...cleaned].some((character) => character.charCodeAt(0) < 32) ||
         /[. ]$/.test(cleaned) ||
         /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
      )
         throw new Error("That name contains characters reserved for files. Choose another name.");
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before renaming clips.");
      if (this.pendingJobs.some((job) => job.clipId === id)) throw new Error("Finish or cancel this clip's shareable before renaming it.");
      const stored = this.stored(id);
      const original = await this.resolveFile(stored);
      if (!original) throw new Error("The original video moved or changed. Try again after the library updates.");
      const moves: { file: StoredFile; source: string; destination: string; removed: boolean }[] = [];
      const addMove = (file: StoredFile, source: string, filename: string) => {
         const destination = join(dirname(source), filename);
         if (normal(destination) !== normal(source)) moves.push({ file, source, destination, removed: false });
      };
      addMove(stored, original, `${cleaned}${extname(original)}`);
      for (const share of stored.shareables) {
         const source = await this.resolveFile(share);
         if (!source) throw new Error("A shareable moved or changed. Try renaming again after the library updates.");
         addMove(share, source, `${cleaned}-${share.targetMB}MB-${share.id.slice(0, 8)}${extname(source)}`);
      }
      // Publish every destination before removing any source, so a collision leaves the group intact.
      const published: typeof moves = [];
      try {
         for (const move of moves) {
            await publishWithoutOverwrite(move.source, move.destination);
            published.push(move);
         }
      } catch (error) {
         for (const move of published) await rm(move.destination, { force: true });
         if ((error as NodeJS.ErrnoException).code === "EEXIST")
            throw new Error("A video with that name already exists. Choose another name.", { cause: error });
         throw error;
      }
      try {
         for (const move of moves) {
            await rm(move.source);
            move.removed = true;
            move.file.relativePath = relative(this.root, move.destination);
            move.file.absolutePath = move.destination;
         }
      } catch (error) {
         // Keep completed moves associated and remove unused copies if a source cannot be removed.
         for (const move of moves) if (!move.removed) await rm(move.destination, { force: true });
         await this.writeMetadata();
         await this.scan();
         throw error;
      }
      stored.name = cleaned;
      await this.writeMetadata();
      await this.scan();
   }
   async registerRecording(path: string, source: string, application?: ApplicationArtwork): Promise<Clip> {
      const actual = await realpath(path);
      if (!withinRoot(this.root, actual)) throw new Error("The saved recording is outside the collection.");
      // Registration scans publish library updates before this method returns.
      // Give those scans the known source before they expose the new recording.
      this.registeringSources.set(normal(actual), source);
      try {
         return await this.registerKnownRecording(actual, source, application);
      } finally {
         this.registeringSources.delete(normal(actual));
      }
   }
   private async registerKnownRecording(actual: string, source: string, application?: ApplicationArtwork): Promise<Clip> {
      await this.scan();
      let clip = this.clips.find((entry) => normal(entry.path) === normal(actual));
      if (!clip) {
         // A watcher scan may have listed the directory before this save finished.
         // Its completed snapshot cannot establish that the new file is unreadable.
         await this.scan();
         clip = this.clips.find((entry) => normal(entry.path) === normal(actual));
      }
      if (!clip) throw new Error("The recording finished, but could not be opened. Its file has been kept.");
      this.stored(clip.id).source = source;
      if (application) {
         try {
            const stored = await storeApplicationArtwork(this.root, application);
            if (stored) this.stored(clip.id).application = stored;
         } catch {
            /* Artwork failure must not turn a completed clip into a failed save. */
         }
      }
      await this.writeMetadata();
      if (this.scanRunning) await this.scanRunning;
      await this.scan();
      return this.visible(clip.id);
   }
   async createCategory(name: string, color = "#b197fc", icon = "tag"): Promise<void> {
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing tags.");
      const cleaned = name.trim();
      if (!cleaned || cleaned.length > 80) throw new Error("Choose a tag name between 1 and 80 characters.");
      if (icon.length > 80) throw new Error("Choose a valid tag icon.");
      if (!/^#[\da-f]{6}$/i.test(color)) throw new Error("Choose a valid tag color.");
      if (this.categories.some((category) => category.name.toLowerCase() === cleaned.toLowerCase())) throw new Error("A tag with that name already exists.");
      this.metadata.categories.push({ id: randomUUID(), name: cleaned, color, icon });
      await this.writeMetadata();
      this.notify();
   }
   async updateCategory(id: string, name: string, color: string, icon: string): Promise<void> {
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing tags.");
      const category = this.metadata.categories.find((item) => item.id === id);
      if (!category) throw new Error("That tag no longer exists.");
      const cleaned = name.trim();
      if (!cleaned || cleaned.length > 80 || !/^#[\da-f]{6}$/i.test(color) || icon.length > 80) throw new Error("Choose a valid tag name, color and icon.");
      if (this.categories.some((item) => item.id !== id && item.name.toLowerCase() === cleaned.toLowerCase()))
         throw new Error("A tag with that name already exists.");
      Object.assign(category, { name: cleaned, color, icon });
      await this.writeMetadata();
      this.notify();
   }
   async reorderCategory(id: string, beforeId: string | null): Promise<void> {
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing tags.");
      const category = this.categories.find((item) => item.id === id);
      if (!category || (beforeId !== null && !this.categories.some((item) => item.id === beforeId))) throw new Error("That tag no longer exists.");
      if (id === beforeId) return;
      const next = this.categories.filter((item) => item.id !== id);
      const index = beforeId === null ? next.length : next.findIndex((item) => item.id === beforeId);
      next.splice(index, 0, category);
      this.metadata.categories = next;
      await this.writeMetadata();
      this.notify();
   }
   async deleteCategory(id: string): Promise<void> {
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing tags.");
      this.metadata.categories = this.categories.filter((category) => category.id !== id);
      for (const clip of this.metadata.clips) clip.categories = clip.categories.filter((category) => category !== id);
      await this.writeMetadata();
      await this.scan();
   }
   async assignCategories(id: string, ids: string[]): Promise<void> {
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before changing tags.");
      if (ids.some((category) => !this.categories.some((entry) => entry.id === category))) throw new Error("That tag no longer exists.");
      this.stored(id).categories = [...new Set(ids)];
      await this.writeMetadata();
      await this.scan();
   }
   toggleCategory(clipId: string, categoryId: string): Promise<void> {
      const current = this.stored(clipId).categories;
      return this.assignCategories(clipId, current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId]);
   }

   async filesForDeletion(id: string, shareableId?: string, scope?: "shareables"): Promise<string[]> {
      if (this.pendingJobs.some((job) => job.clipId === id)) throw new Error("Finish or cancel this clip's shareable before deleting it.");
      const stored = this.stored(id);
      const files: StoredFile[] = shareableId
         ? stored.shareables.filter((share) => share.id === shareableId)
         : scope === "shareables"
           ? stored.shareables
           : [stored, ...stored.shareables];
      if (shareableId && !files.length) throw new Error("That shareable no longer exists.");
      const result: string[] = [];
      for (const file of files) {
         const path = await this.resolveFile(file);
         if (path && withinRoot(this.root, path)) result.push(path);
      }
      return [...new Set(result)];
   }
   async removeDeleted(id: string, paths: string[]): Promise<void> {
      const stored = this.stored(id);
      const deleted = new Set(paths.map((path) => normal(resolve(path))));
      stored.shareables = stored.shareables.filter((share) => !deleted.has(normal(resolve(this.root, share.relativePath))));
      // Retain associations for shareables that failed to trash, even if the original is gone.
      if (deleted.has(normal(resolve(this.root, stored.relativePath))) && !stored.shareables.length)
         this.metadata.clips = this.metadata.clips.filter((clip) => clip.id !== id);
      await this.writeMetadata();
      await this.scan();
   }

   private jobUpdate(job: Job, change: Partial<Job>) {
      Object.assign(job, change);
      this.options.onJob?.({ ...job });
      this.notify();
   }
   async createShareable(id: string, targetMB: number): Promise<void> {
      if (!Number.isFinite(targetMB) || targetMB < 0.1 || targetMB > 10000) throw new Error("Choose a size limit between 0.1 and 10,000 MB.");
      if (!this.metadataWritable) throw new Error("Restore the collection metadata before creating shareables.");
      const clip = this.visible(id);
      if (clip.originalMissing) throw new Error("The original is missing. Existing shareables are still available.");
      const job: Job = { id: randomUUID(), clipId: id, kind: "shareable", state: "queued", progress: 0, message: "Waiting to create shareable" };
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      this.jobs.push(job);
      this.jobUpdate(job, {});
      const operation = this.queue
         .catch(() => undefined)
         .then(async () => {
            const temporaryFiles: string[] = [];
            try {
               if (controller.signal.aborted) throw new Error("Cancelled");
               this.jobUpdate(job, { state: "running", message: "Creating shareable" });
               const original = await this.resolveFile(this.stored(id));
               if (!original) throw new Error("The original video moved or changed. Try again after the library updates.");
               const sharesRoot = join(this.root, "shareables");
               let existing = false;
               try {
                  await stat(sharesRoot);
                  existing = true;
               } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
               }
               if (existing && !(await this.shareablesOwned()))
                  throw new Error(
                     "A shareables folder already exists and is not owned by AcroClip. Rename it or choose another collection before creating shareables."
                  );
               await this.safeDirectory(sharesRoot);
               if (!existing)
                  await writeFile(join(sharesRoot, ".acroclip-owner.json"), JSON.stringify({ collectionId: this.metadata.collectionId }), { flag: "wx" });
               const folder = join(sharesRoot, dirname(clip.relativePath));
               await this.safeDirectory(folder);
               const final = join(folder, `${basename(original, extname(original))}-${targetMB}MB-${job.id.slice(0, 8)}.mp4`);
               const temporary = join(folder, `.acroclip-${job.id}.mp4`);
               const passLog = join(this.root, ".acroclip", `pass-${job.id}`);
               temporaryFiles.push(temporary, `${passLog}-0.log`, `${passLog}-0.log.mbtree`);
               const info = await probe(original);
               let verified = false;
               for (let attempt = 0; attempt < 3; attempt++) {
                  await encodeShareable(original, temporary, passLog, info, targetMB * Math.pow(0.9, attempt), {
                     signal: controller.signal,
                     onProgress: (progress) => this.jobUpdate(job, { progress, message: attempt ? "Adjusting to fit size limit" : "Creating shareable" }),
                  });
                  const size = (await stat(temporary)).size;
                  const outputInfo = await probe(temporary);
                  if (Math.abs(outputInfo.duration - info.duration) > Math.max(0.25, 2 / info.frameRate))
                     throw new Error("The shareable did not retain the complete clip. The original is safe.");
                  if (outputInfo.tracks.length !== Math.min(1, info.tracks.length))
                     throw new Error("The shareable's audio could not be verified. The original is safe.");
                  if (size <= Math.floor(targetMB * 1_000_000)) {
                     verified = true;
                     break;
                  }
               }
               if (!verified) throw new Error("The shareable could not fit the size limit. Choose a larger limit.");
               if (controller.signal.aborted) throw new Error("Cancelled");
               if ((await fileIdentity(original)) !== this.stored(id).identity)
                  throw new Error("The original changed during export. Try creating the shareable again.");
               // Hard-link publication is atomic and cannot overwrite a pre-existing file.
               await publishWithoutOverwrite(temporary, final);
               const identity = await fileIdentity(final);
               const size = (await stat(final)).size;
               this.stored(id).shareables.push({
                  id: job.id,
                  relativePath: relative(this.root, final),
                  absolutePath: final,
                  identity,
                  size,
                  targetMB,
                  createdAt: Date.now(),
               });
               await this.writeMetadata();
               await this.scan();
               this.jobUpdate(job, { state: "complete", progress: 1, message: "Shareable ready" });
            } catch (error) {
               this.jobUpdate(job, {
                  state: controller.signal.aborted ? "cancelled" : "failed",
                  message: controller.signal.aborted ? "Shareable cancelled. Original kept." : message(error),
               });
            } finally {
               await Promise.all(temporaryFiles.map((path) => rm(path, { force: true }).catch(() => undefined)));
               this.controllers.delete(job.id);
            }
         });
      this.queue = operation;
      await operation;
   }
   cancelJob(id: string): void {
      this.controllers.get(id)?.abort();
   }

   async playback(path: string, track?: number | number[], signal?: AbortSignal): Promise<string> {
      const lifetime = this.playbackLifetime.signal;
      const operation = signal ? AbortSignal.any([signal, lifetime]) : lifetime;
      const root = this.root;
      const actual = await realpath(path);
      if (root !== this.root || !withinRoot(root, actual)) throw new Error("The video is outside the current collection.");
      const allowed = this.clips.some((clip) => normal(clip.path) === normal(actual) || clip.shareables.some((share) => normal(share.path) === normal(actual)));
      if (!allowed) throw new Error("That video is not part of this collection.");
      const directory = join(root, ".acroclip", "playback");
      await this.safeDirectory(directory);
      const result = await this.playbackCache.prepare(actual, directory, track, operation);
      if (root !== this.root) throw new Error("The collection changed while preparing playback.");
      return this.url(result);
   }
}
