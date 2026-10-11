import { statfs } from "node:fs/promises";

const lowStorageBytes = 1024n * 1024n * 1024n;
const checkInterval = 30_000;
const checkTimeout = 3000;
type SpaceReader = (directory: string) => Promise<bigint>;
interface StorageOptions {
   onChange: () => void;
   onWarning: (message: string) => void;
   readSpace?: SpaceReader;
}
async function availableSpace(directory: string): Promise<bigint> {
   const stats = await statfs(directory, { bigint: true });
   return stats.bavail * stats.bsize;
}

/** A free-space warning never changes capture state or estimates whether a clip will fit. */
export class StorageMonitor {
   private readonly options: StorageOptions;
   private readonly readSpace: SpaceReader;
   private root = "";
   private message = "";
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
   private publish(message: string): void {
      if (message === this.message) return;
      this.message = message;
      this.options.onChange();
      if (message) this.options.onWarning(message);
   }
   setActivity(root: string, active: boolean): void {
      if (root !== this.root) {
         if (this.timer) clearInterval(this.timer);
         this.timer = null;
         this.root = root;
         this.generation++;
         this.pending = null;
         this.spaceRead = null;
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
         this.publish(available === undefined ? "Free storage could not be checked" : available < lowStorageBytes ? "Low storage in clip folder" : "");
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
