import { appendFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { statsFileName, statsVersion } from "../shared/stats";
import { parseStatsLog, statsEventSchema } from "../shared/stats-log";
import type { StatsEvent, StatsEventInput } from "../shared/stats-log";

export interface StatsOptions {
   /** The open collection, or "" while none is open. */
   root: () => string;
   /** Creates the stats folder inside the collection and returns it. */
   directory: (root: string) => Promise<string>;
   enabled: () => boolean;
   onError?: (message: string) => void;
   /** Batching delay. Writes are a few hundred bytes, so this only saves wakeups. */
   delayMs?: number;
}

/**
 * Appends usage events to the collection, so the history travels with the clips.
 * Writing never blocks the caller and never throws into it: a stats failure must not
 * cost a save, a share or a delete.
 */
export class StatsLog {
   private pending: Array<{ root: string; event: StatsEvent }> = [];
   private timer: NodeJS.Timeout | undefined;
   private writing: Promise<void> = Promise.resolve();
   private failed = false;
   private readonly options: StatsOptions;
   constructor(options: StatsOptions) {
      this.options = options;
   }

   record(input: StatsEventInput, at = Date.now()): void {
      const root = this.options.root();
      if (!root || !this.options.enabled()) return;
      const parsed = statsEventSchema.safeParse(input);
      if (!parsed.success) {
         this.options.onError?.(`stats: dropped an invalid ${input.type} event`);
         return;
      }
      this.pending.push({ root, event: { ...parsed.data, v: statsVersion, at } });
      this.timer ??= setTimeout(() => void this.flush(), this.options.delayMs ?? 2000);
   }

   /** Writes everything recorded so far. Safe to call repeatedly, such as before quitting. */
   flush(): Promise<void> {
      clearTimeout(this.timer);
      this.timer = undefined;
      const batch = this.pending;
      this.pending = [];
      this.writing = this.writing.then(() => this.write(batch));
      return this.writing;
   }

   /** Removes every recorded event for a collection, including ones not written yet. */
   async clear(root: string): Promise<void> {
      this.pending = this.pending.filter((entry) => entry.root !== root);
      await this.writing;
      await rm(join(root, ".acroclip", "stats"), { recursive: true, force: true });
   }

   async read(root: string): Promise<StatsEvent[]> {
      await this.flush();
      const directory = join(root, ".acroclip", "stats");
      const names = await readdir(directory).catch(() => [] as string[]);
      const files = names.filter((name) => /^events-\d{4}-\d{2}\.jsonl$/.test(name)).sort();
      const events = await Promise.all(files.map(async (name) => parseStatsLog(await readFile(join(directory, name), "utf8").catch(() => ""))));
      return events.flat();
   }

   private async write(batch: Array<{ root: string; event: StatsEvent }>): Promise<void> {
      const files = new Map<string, { root: string; name: string; lines: string[] }>();
      for (const { root, event } of batch) {
         const name = statsFileName(event.at);
         const key = `${root}\n${name}`;
         const file = files.get(key) ?? { root, name, lines: [] };
         file.lines.push(JSON.stringify(event));
         files.set(key, file);
      }
      for (const file of files.values()) {
         try {
            const directory = await this.options.directory(file.root);
            await appendFile(join(directory, file.name), `${file.lines.join("\n")}\n`, "utf8");
            this.failed = false;
         } catch (error) {
            this.report(`stats: ${error instanceof Error ? error.message : String(error)}`);
         }
      }
   }

   // A read-only collection would otherwise log on every event.
   private report(message: string) {
      if (this.failed) return;
      this.failed = true;
      this.options.onError?.(message);
   }
}
