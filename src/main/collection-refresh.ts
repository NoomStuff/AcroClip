import { watch, type FSWatcher } from "node:fs";

/** How long file events settle before one refresh reads the collection. */
export const SETTLE_MS = 250;
/** Network and removable volumes can drop file events, so a slow poll still runs while the library is in view. */
export const FALLBACK_POLL_MS = 30_000;
/** Without a working watcher, polling is the only way to notice outside changes. */
export const UNWATCHED_POLL_MS = 5000;

interface RefreshOptions {
   refresh: () => Promise<unknown>;
   /** Refreshing waits while exports write into the collection. */
   busy: () => boolean;
   log: (message: string) => void;
   watch?: typeof watch;
}

// AcroClip's own writes land here and never change the library.
const ownedPath = (name: string) => /(^|[\\/])\.acroclip([\\/]|$)/.test(name) || /(^|[\\/])\.acroclip-[^\\/]*$/.test(name);

/**
 * Keeps the open collection current only while someone can see it. Hidden
 * windows do no filesystem work, so capture and games keep the disk to themselves.
 */
export class CollectionRefresh {
   private readonly options: RefreshOptions;
   private root = "";
   private active = false;
   private watcher: FSWatcher | null = null;
   private settle: ReturnType<typeof setTimeout> | null = null;
   private poll: ReturnType<typeof setInterval> | null = null;
   private running = false;
   private again = false;
   constructor(options: RefreshOptions) {
      this.options = options;
   }
   /** Follows `root` while `active`. Becoming active refreshes at once. */
   update(root: string, active: boolean): void {
      const changedRoot = root !== this.root;
      if (!changedRoot && active === this.active) return;
      const resumed = active && (!this.active || changedRoot);
      this.stop();
      this.root = root;
      this.active = active && !!root;
      if (!this.active) return;
      this.watcher = this.startWatcher(root);
      this.poll = setInterval(() => this.request(0), this.watcher ? FALLBACK_POLL_MS : UNWATCHED_POLL_MS);
      this.poll.unref();
      if (resumed) this.request(0);
   }
   close(): void {
      this.stop();
      this.active = false;
   }
   private startWatcher(root: string): FSWatcher | null {
      try {
         const watcher = (this.options.watch ?? watch)(root, { recursive: true, persistent: false }, (_event, name) => {
            if (name === null || !ownedPath(String(name))) this.request(SETTLE_MS);
         });
         watcher.on("error", (error) => {
            this.options.log(`Collection watcher stopped, polling instead: ${error.message}`);
            if (this.watcher !== watcher) return;
            watcher.close();
            this.watcher = null;
            if (this.poll) clearInterval(this.poll);
            this.poll = setInterval(() => this.request(0), UNWATCHED_POLL_MS);
            this.poll.unref();
         });
         return watcher;
      } catch (error) {
         this.options.log(`Collection watcher unavailable, polling instead: ${error instanceof Error ? error.message : String(error)}`);
         return null;
      }
   }
   private stop(): void {
      this.watcher?.close();
      this.watcher = null;
      if (this.settle) clearTimeout(this.settle);
      this.settle = null;
      if (this.poll) clearInterval(this.poll);
      this.poll = null;
   }
   private request(delay: number): void {
      if (!this.active) return;
      if (this.running) {
         this.again = true;
         return;
      }
      if (this.settle) clearTimeout(this.settle);
      this.settle = setTimeout(() => void this.run(), delay);
      this.settle.unref();
   }
   private async run(): Promise<void> {
      this.settle = null;
      if (!this.active || this.options.busy()) return;
      this.running = true;
      try {
         await this.options.refresh();
      } catch (error) {
         this.options.log(error instanceof Error ? error.message : String(error));
      } finally {
         this.running = false;
         if (this.again) {
            this.again = false;
            this.request(SETTLE_MS);
         }
      }
   }
}
