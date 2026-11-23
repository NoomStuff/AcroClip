import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";

/**
 * Loudness envelopes, kept across launches so a clip's peak moments show at once instead of
 * decoding its audio again. The collection keys them by file identity, so a changed file measures
 * again. Levels are stored as one byte each, which is finer than the curve can draw, and the
 * least recently used entries go once the cache holds `limit`.
 */
export class LoudnessCache {
   private readonly entries = new Map<string, string>();
   private loaded: Promise<void> | undefined;
   private saveTimer: ReturnType<typeof setTimeout> | undefined;
   readonly file: string;
   private readonly limit: number;
   constructor(file: string, limit = 50_000) {
      this.file = file;
      this.limit = limit;
   }

   static key(path: string, size: number, modified: number): string {
      return `${path}\0${size}\0${Math.round(modified)}`;
   }

   async get(key: string): Promise<number[] | undefined> {
      await this.load();
      const stored = this.entries.get(key);
      if (stored === undefined) return undefined;
      // Most recently used last, so the oldest go first.
      this.entries.delete(key);
      this.entries.set(key, stored);
      return decodeLevels(stored);
   }

   async set(key: string, levels: readonly number[]): Promise<void> {
      await this.load();
      this.entries.delete(key);
      this.entries.set(key, encodeLevels(levels));
      for (const oldest of this.entries.keys()) {
         if (this.entries.size <= this.limit) break;
         this.entries.delete(oldest);
      }
      this.scheduleSave();
   }

   /** Forgets entries whose key isn't in `keys`, such as clips no longer in the collection. */
   async retain(keys: ReadonlySet<string>): Promise<void> {
      await this.load();
      let removed = false;
      for (const key of [...this.entries.keys()])
         if (!keys.has(key)) {
            this.entries.delete(key);
            removed = true;
         }
      if (removed) this.scheduleSave();
   }

   /** Drops a pending write, for a cache whose folder is about to be cleared. */
   discard(): void {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
   }

   /** Writes pending entries now, such as when the app quits. */
   async flush(): Promise<void> {
      if (this.saveTimer === undefined) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.save();
   }

   private load(): Promise<void> {
      this.loaded ??= readFile(this.file, "utf8").then(
         (text) => {
            const parsed = cacheSchema.safeParse(JSON.parse(text));
            if (parsed.success) for (const [key, levels] of parsed.data.entries) this.entries.set(key, levels);
         },
         // A missing or damaged cache only means measuring again.
         () => undefined
      );
      return this.loaded.catch(() => undefined);
   }

   private scheduleSave(): void {
      if (this.saveTimer !== undefined) return;
      this.saveTimer = setTimeout(() => {
         this.saveTimer = undefined;
         void this.save();
      }, 2000);
      this.saveTimer.unref?.();
   }

   private async save(): Promise<void> {
      const temporary = `${this.file}.${process.pid}.tmp`;
      try {
         await writeFile(temporary, JSON.stringify({ version: 1, entries: [...this.entries] }));
         await rename(temporary, this.file);
      } catch {
         /* The cache is a convenience. The next save tries again. */
      }
   }
}

const cacheSchema = z.object({ version: z.literal(1), entries: z.array(z.tuple([z.string().max(8192), z.string().max(4096)])).max(100_000) });

export function encodeLevels(levels: readonly number[]): string {
   return Buffer.from(levels.map((level) => Math.round(Math.min(1, Math.max(0, level)) * 255))).toString("base64");
}

export function decodeLevels(encoded: string): number[] {
   return Array.from(Buffer.from(encoded, "base64"), (byte) => byte / 255);
}
