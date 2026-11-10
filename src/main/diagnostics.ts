import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ZipEntry } from "./zip";

export type LogLevel = "info" | "warn" | "error";

/**
 * One rotating log file. Lines queue in memory and reach disk in order, after `delayMs`
 * (0 writes on the next turn). A rotation keeps exactly one previous file, so the folder
 * stays bounded at roughly twice `maxBytes`.
 */
export class LogFile {
   private pending: string[] = [];
   private timer: NodeJS.Timeout | undefined;
   private writing: Promise<void> = Promise.resolve();
   private ready = false;
   readonly path: string;
   private readonly maxBytes: number;
   private readonly delayMs: number;
   constructor(path: string, maxBytes: number, delayMs = 0) {
      this.path = path;
      this.maxBytes = maxBytes;
      this.delayMs = delayMs;
   }

   get previousPath(): string {
      return `${this.path}.previous`;
   }

   write(text: string): void {
      this.pending.push(text);
      if (this.timer) return;
      this.timer = setTimeout(() => void this.flush(), this.delayMs);
      this.timer.unref?.();
   }

   flush(): Promise<void> {
      clearTimeout(this.timer);
      this.timer = undefined;
      const text = this.pending.join("");
      this.pending = [];
      if (!text) return this.writing;
      this.writing = this.writing.then(() => this.append(text)).catch(() => undefined);
      return this.writing;
   }

   /** For a process that is about to die: no promise will get to run. */
   flushSync(): void {
      clearTimeout(this.timer);
      this.timer = undefined;
      const text = this.pending.join("");
      this.pending = [];
      if (!text) return;
      try {
         mkdirSync(join(this.path, ".."), { recursive: true });
         if ((statSync(this.path, { throwIfNoEntry: false })?.size ?? 0) > this.maxBytes) {
            rmSync(this.previousPath, { force: true });
            renameSync(this.path, this.previousPath);
         }
         appendFileSync(this.path, text);
      } catch {
         /* Diagnostics must not break the app, even while it fails. */
      }
   }

   private async append(text: string) {
      if (!this.ready) {
         await mkdir(join(this.path, ".."), { recursive: true });
         this.ready = true;
      }
      if (((await stat(this.path).catch(() => null))?.size ?? 0) > this.maxBytes) {
         await rm(this.previousPath, { force: true });
         await rename(this.path, this.previousPath).catch(() => undefined);
      }
      await appendFile(this.path, text);
   }
}

const sessionSchema = z.object({
   version: z.string().max(100),
   pid: z.number().int(),
   startedAt: z.number(),
   endedAt: z.number().optional(),
   clean: z.boolean(),
   // Set when the process noticed its own failure before it went down.
   crash: z.string().max(2000).optional(),
});
export type SessionRecord = z.infer<typeof sessionSchema>;

export interface DiagnosticsOptions {
   directory: string;
   version: string;
   pid?: number;
   now?: () => number;
   /** Per file, before it rotates. */
   appLogBytes?: number;
   recorderLogBytes?: number;
}

const historyLimit = 50;

/**
 * Local diagnostics: the app log, the native recorder's own log, and a record of how each run
 * ended. Nothing here leaves the computer; an export packs it for the user to attach themselves.
 */
export class Diagnostics {
   readonly directory: string;
   readonly app: LogFile;
   readonly recorder: LogFile;
   private readonly options: DiagnosticsOptions;
   private session: SessionRecord | undefined;
   private recorderPartial = "";
   constructor(options: DiagnosticsOptions) {
      this.options = options;
      this.directory = options.directory;
      this.app = new LogFile(join(options.directory, "app.log"), options.appLogBytes ?? 2 * 1024 * 1024);
      // The recorder writes OBS's log, which can burst during source changes.
      this.recorder = new LogFile(join(options.directory, "recorder.log"), options.recorderLogBytes ?? 4 * 1024 * 1024, 1000);
   }

   private get now() {
      return (this.options.now ?? Date.now)();
   }
   private get sessionPath() {
      return join(this.directory, "session.json");
   }
   private get historyPath() {
      return join(this.directory, "sessions.jsonl");
   }

   log(message: string, level: LogLevel = "info"): void {
      const text = message.replace(/\r?\n/g, "\n    ");
      this.app.write(`${new Date(this.now).toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`);
   }

   /** Raw output from the native recorder, kept whole for bug reports. */
   recorderOutput(chunk: string): void {
      const text = this.recorderPartial + chunk;
      const end = text.lastIndexOf("\n");
      // Hold a partial line until it completes, so timestamps sit at line starts.
      this.recorderPartial = end === -1 ? text : text.slice(end + 1);
      if (this.recorderPartial.length > 64 * 1024) {
         this.recorder.write(`${this.recorderPartial}\n`);
         this.recorderPartial = "";
      }
      if (end === -1) return;
      const stamp = new Date(this.now).toISOString();
      const lines = text
         .slice(0, end)
         .split(/\r?\n/)
         .map((line) => `${stamp} ${line}\n`);
      this.recorder.write(lines.join(""));
   }

   recorderStarted(detail: string): void {
      this.recorderPartial = "";
      this.recorder.write(`\n${new Date(this.now).toISOString()} ===== recorder started: ${detail} =====\n`);
   }

   /**
    * Marks this run as started and returns how the previous one ended. A previous run that
    * never marked itself clean crashed, was killed, or lost power.
    */
   async begin(): Promise<SessionRecord | null> {
      await mkdir(this.directory, { recursive: true });
      const previous = await readFile(this.sessionPath, "utf8")
         .then((text) => sessionSchema.safeParse(JSON.parse(text)))
         .then((result) => (result.success ? result.data : null))
         .catch(() => null);
      if (previous) await this.remember(previous).catch(() => undefined);
      this.session = { version: this.options.version, pid: this.options.pid ?? process.pid, startedAt: this.now, clean: false };
      await writeFile(this.sessionPath, JSON.stringify(this.session));
      return previous;
   }

   /** Writes synchronously: this runs while the app quits. */
   end(): void {
      if (!this.session) return;
      this.session = { ...this.session, clean: true, endedAt: this.now };
      this.app.flushSync();
      this.recorder.flushSync();
      try {
         writeFileSync(this.sessionPath, JSON.stringify(this.session));
      } catch {
         /* The next run reports this one as unclean, which is the safe mistake. */
      }
   }

   /** The process is going down with this error. Keep it with the run, and get the logs on disk. */
   crashed(description: string): void {
      this.log(`crash: ${description}`, "error");
      this.app.flushSync();
      this.recorder.flushSync();
      if (!this.session) return;
      this.session = { ...this.session, crash: description.slice(0, 2000) };
      try {
         writeFileSync(this.sessionPath, JSON.stringify(this.session));
      } catch {
         /* Already failing. */
      }
   }

   /** Past runs, oldest first, not counting the current one. */
   async history(): Promise<SessionRecord[]> {
      const text = await readFile(this.historyPath, "utf8").catch(() => "");
      return text.split("\n").flatMap((line) => {
         try {
            const parsed = sessionSchema.safeParse(JSON.parse(line));
            return parsed.success ? [parsed.data] : [];
         } catch {
            return [];
         }
      });
   }

   async flush(): Promise<void> {
      await Promise.all([this.app.flush(), this.recorder.flush()]);
   }

   /** Every log file, with `redact` applied, ready for an archive. */
   async entries(redact: (text: string) => string): Promise<ZipEntry[]> {
      await this.flush();
      const files = [this.app.previousPath, this.app.path, this.recorder.previousPath, this.recorder.path, this.historyPath];
      const entries = await Promise.all(
         files.map(async (path): Promise<ZipEntry[]> => {
            const text = await readFile(path, "utf8").catch(() => null);
            const name = path.slice(this.directory.length + 1).replace(/\\/g, "/");
            return text === null ? [] : [{ name: `logs/${name}`, data: redact(text) }];
         })
      );
      return entries.flat();
   }

   private async remember(previous: SessionRecord) {
      const history = [...(await this.history()), previous].slice(-historyLimit);
      await writeFile(this.historyPath, history.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
   }
}

/**
 * Replaces the user's home folder with `~`, so an export doesn't carry their account name.
 * Windows paths compare without case, and either slash direction.
 */
export function homeRedactor(home: string, platform: NodeJS.Platform = process.platform): (text: string) => string {
   const trimmed = home.replace(/[\\/]+$/, "");
   if (trimmed.length < 3) return (text) => text;
   const variants = new Set([trimmed, trimmed.replace(/\\/g, "/"), trimmed.replace(/\//g, "\\"), trimmed.replace(/\\/g, "\\\\")]);
   const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
   const pattern = new RegExp([...variants].map(escape).join("|"), platform === "win32" ? "gi" : "g");
   return (text) => text.replace(pattern, "~");
}

/** Reads the current session marker synchronously, for tests and crash handlers. */
export function readSession(directory: string): SessionRecord | null {
   try {
      const parsed = sessionSchema.safeParse(JSON.parse(readFileSync(join(directory, "session.json"), "utf8")));
      return parsed.success ? parsed.data : null;
   } catch {
      return null;
   }
}
