import { statfs } from "node:fs/promises";
import { dirname, win32 } from "node:path";

const lowStorageBytes = 1024n * 1024n * 1024n;
const checkInterval = 30_000;
const checkTimeout = 3000;
type SpaceReader = (directory: string) => Promise<bigint>;
interface StorageOptions {
   onChange: () => void;
   /** Free space dropped below the limit. `detail` says how much is left and where. */
   onWarning: (message: string, detail: string) => void;
   /** Free space couldn't be read. Nothing is asked of the user, so this only reaches the log. */
   onUnreadable?: () => void;
   readSpace?: SpaceReader;
}
export const lowStorageWarning = "Low storage";

/** Below the 1 GiB limit, megabytes are always the right unit. */
export function lowStorageDetail(root: string, available: bigint, platform: NodeJS.Platform = process.platform): string {
   const megabytes = available / (1024n * 1024n);
   const drive = platform === "win32" ? win32.parse(root).root.replace(/\\$/, "") : "";
   return `Only ${megabytes.toLocaleString("en-US")} MB left on ${drive || "the collection's drive"}, so new clips may not save.`;
}
/**
 * Free space on the volume that holds `directory`. A collection folder that was deleted, or not
 * made yet, is recreated by the next save on the same volume, so its nearest existing parent answers.
 */
export async function availableSpace(directory: string): Promise<bigint> {
   for (let current = directory; ;) {
      try {
         const stats = await statfs(current, { bigint: true });
         return stats.bavail * stats.bsize;
      } catch (error) {
         const parent = dirname(current);
         if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === current) throw error;
         current = parent;
      }
   }
}

/** A free-space warning never changes capture state or estimates whether a clip will fit. */
export class StorageMonitor {
   private readonly options: StorageOptions;
   private readonly readSpace: SpaceReader;
   private root = "";
   private message = "";
   private unreadable = false;
   private timer: ReturnType<typeof setInterval> | null = null;
   private pending: Promise<void> | null = null;
   private spaceRead: { root: string; promise: Promise<bigint | undefined> } | null = null;
   private generation = 0;
   constructor(options: StorageOptions) {
      this.options = options;
      this.readSpace = options.readSpace ?? availableSpace;
   }
   get warning(): string {
      return this.message;
   }
   private publish(message: string, detail = ""): void {
      if (message === this.message) return;
      this.message = message;
      this.options.onChange();
      if (message) this.options.onWarning(message, detail);
   }
   setActivity(root: string, active: boolean): void {
      if (root !== this.root) {
         if (this.timer) clearInterval(this.timer);
         this.timer = null;
         this.root = root;
         this.generation++;
         this.pending = null;
         this.spaceRead = null;
         this.unreadable = false;
         this.publish("");
      }
      if (!root || !active) {
         if (this.timer) clearInterval(this.timer);
         this.timer = null;
         return;
      }
      if (!this.timer) {
         this.timer = setInterval(() => void this.check(root), checkInterval);
         this.timer.unref();
         void this.check(root);
      }
   }
   async check(root: string): Promise<void> {
      if (!root || root !== this.root) return;
      if (this.pending) return this.pending;
      const generation = this.generation;
      // A timeout cannot cancel statfs. Reuse its outstanding read rather than
      // accumulating filesystem requests against a disconnected network volume.
      if (!this.spaceRead || this.spaceRead.root !== root) {
         const read = {
            root,
            promise: this.readSpace(root)
               .catch(() => undefined)
               .finally(() => {
                  if (this.spaceRead === read) this.spaceRead = null;
               }),
         };
         this.spaceRead = read;
      }
      const reading = this.spaceRead.promise;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const check = (async () => {
         const available = await Promise.race([
            reading,
            new Promise<undefined>((resolve) => {
               timeout = setTimeout(() => resolve(undefined), checkTimeout);
            }),
         ]);
         if (timeout) clearTimeout(timeout);
         if (generation !== this.generation) return;
         // An unreadable volume keeps the last answer. It may only be slow, and it's checked again soon.
         if (available === undefined) {
            if (!this.unreadable) this.options.onUnreadable?.();
            this.unreadable = true;
            return;
         }
         this.unreadable = false;
         if (available < lowStorageBytes) this.publish(lowStorageWarning, lowStorageDetail(root, available));
         else this.publish("");
      })();
      this.pending = check;
      try {
         await check;
      } finally {
         if (this.pending === check) this.pending = null;
      }
   }
   close(): void {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.generation++;
      this.pending = null;
   }
}
