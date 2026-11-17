import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { posix } from "node:path";
import { z } from "zod";
import type { DiscordPresenceLevel } from "../shared/types";

/** AcroClip's application in the Discord Developer Portal. */
export const DISCORD_CLIENT_ID = "1572245694125842472";
/** The Rich Presence art asset uploaded to that application. */
export const DISCORD_LOGO_ASSET = "logo";
/** The status button's link. Its own path lets the site's analytics count visits from Discord. */
export const DISCORD_BUTTON_URL = "https://acroclip.noomstuff.com/drpc";

/**
 * `name` replaces the application's name as the card's title and the member list's "Playing" line,
 * which `status_display_type` 0 picks. Images are asset keys or https URLs.
 */
export interface DiscordActivity {
   type: 0;
   name: string;
   status_display_type: 0;
   details?: string;
   timestamps?: { start: number };
   assets: { large_image: string; large_text: string; small_image?: string; small_text?: string };
   buttons: Array<{ label: string; url: string }>;
   instance: false;
}

export interface PresenceGame {
   name: string;
   /** The game's icon, when Discord's catalog has one. */
   icon?: string;
}

export interface PresenceSituation {
   level: DiscordPresenceLevel;
   /** A capture session is running: from the first recording until capture stops. */
   capturing: boolean;
   /** Capture is waiting for its source to come back. */
   paused: boolean;
   /** The game being captured, when AcroClip can name it. */
   game: PresenceGame | undefined;
   /** When this capture session started. Discord counts up from it. */
   startedAt: number | undefined;
   /** Clips saved this session. A save that extends the previous clip doesn't add one. */
   clips: number;
}

/** How long a recording can go without naming a game before the status lets go of the last one. */
export const GAME_HOLD_MS = 10_000;

/**
 * One status for a whole capture session, so switching sources or losing one for a while doesn't
 * reset the timer, the clip count or the game. It starts at the first recording and ends when
 * capture stops or fails. The last named game stays through pauses and source switches, and only
 * goes once recording has run `GAME_HOLD_MS` without naming one, such as on a plain desktop.
 */
export class PresenceSession {
   private current: { startedAt: number; clips: number; game: PresenceGame | undefined; unnamedSince: number | undefined } | undefined;
   update(state: "stopped" | "starting" | "recording" | "waiting" | "error", named: PresenceGame | undefined, now: number): Omit<PresenceSituation, "level"> {
      if (state === "stopped" || state === "error") this.current = undefined;
      else if (!this.current && state === "recording") this.current = { startedAt: now, clips: 0, game: undefined, unnamedSince: undefined };
      const session = this.current;
      if (!session) return { capturing: false, paused: false, game: undefined, startedAt: undefined, clips: 0 };
      if (state === "recording") {
         if (named) session.game = named;
         session.unnamedSince = named ? undefined : (session.unnamedSince ?? now);
         if (session.unnamedSince !== undefined && now - session.unnamedSince >= GAME_HOLD_MS) session.game = undefined;
      }
      return { capturing: true, paused: state === "waiting", game: session.game, startedAt: session.startedAt, clips: session.clips };
   }
   /** Counts a saved clip, if a session is running. */
   countClip(): boolean {
      if (!this.current) return false;
      this.current.clips++;
      return true;
   }
}

/** Discord refuses text lines outside 2 to 128 characters. */
function presenceText(value: string | undefined, max = 128): string | undefined {
   const text = value?.trim().replace(/\s+/g, " ");
   if (!text || text.length < 2) return undefined;
   return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Where Discord serves a catalog game's icon. */
export function discordGameIcon(applicationId: string, iconHash: string): string {
   return `https://cdn.discordapp.com/app-icons/${applicationId}/${iconHash}.png?size=512`;
}

const fullSuffix = " with AcroClip";

function clipsLine(clips: number, paused: boolean): string {
   const saved = clips === 1 ? "1 clip saved" : `${clips} clips saved`;
   if (paused) return clips === 0 ? "Paused" : `Paused · ${saved}`;
   return clips === 0 ? "Ready to clip" : saved;
}

/**
 * What AcroClip shows on Discord, or null to leave the user's own status alone. While capturing a
 * game it can name, the status is that game's own, "Playing <game>" with its icon, and the timer
 * counts the capture session. Minimal adds AcroClip's logo as a corner badge, "Clipping with AcroClip" and
 * a link. Full names AcroClip in the status, "Playing <game> with AcroClip", lists the clips saved,
 * and also shows "Playing AcroClip" while capturing without a game.
 */
export function presenceActivity(situation: PresenceSituation): DiscordActivity | null {
   if (situation.level === "off" || !situation.capturing) return null;
   const full = situation.level === "full";
   // Full keeps its suffix whole and shortens the game's name instead.
   const game = presenceText(situation.game?.name, full ? 128 - fullSuffix.length : 128);
   if (!game && !full) return null;
   const icon = game ? situation.game?.icon : undefined;
   return {
      type: 0,
      name: !game ? "AcroClip" : full ? `${game}${fullSuffix}` : game,
      status_display_type: 0,
      details: full ? clipsLine(situation.clips, situation.paused) : situation.paused ? "Clipping paused" : "Clipping with AcroClip",
      ...(situation.startedAt !== undefined ? { timestamps: { start: situation.startedAt } } : {}),
      // Without the game's icon, AcroClip's logo stands in rather than a badge on an empty square.
      assets:
         game && icon
            ? { large_image: icon, large_text: game, small_image: DISCORD_LOGO_ASSET, small_text: "AcroClip" }
            : { large_image: DISCORD_LOGO_ASSET, large_text: "AcroClip" },
      buttons: [{ label: "Get AcroClip", url: DISCORD_BUTTON_URL }],
      instance: false,
   };
}

const flatpakApps = ["com.discordapp.Discord", "com.discordapp.DiscordCanary", "dev.vencord.Vesktop"];
const socketFolders = ["", ...flatpakApps.map((id) => `app/${id}`), "snap.discord", "snap.discord-canary", ".flatpak/dev.vencord.Vesktop/xdg-run"];

/**
 * Where a running Discord listens. Windows uses numbered pipes. Elsewhere each client puts its socket
 * in the runtime or temp folder, or inside a Flatpak or Snap's own copy of it.
 */
export function discordIpcPaths(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): string[] {
   const slots = Array.from({ length: 10 }, (_, index) => `discord-ipc-${index}`);
   if (platform === "win32") return slots.map((slot) => `\\\\?\\pipe\\${slot}`);
   const bases = [...new Set([env["XDG_RUNTIME_DIR"], env["TMPDIR"], env["TMP"], env["TEMP"], "/tmp"].filter((base): base is string => !!base))];
   return bases.flatMap((base) => socketFolders.flatMap((folder) => slots.map((slot) => posix.join(base, folder, slot))));
}

export const Op = { Handshake: 0, Frame: 1, Close: 2, Ping: 3, Pong: 4 } as const;
export type Op = (typeof Op)[keyof typeof Op];

export function encodeFrame(op: Op, payload: unknown): Buffer {
   const body = Buffer.from(JSON.stringify(payload), "utf8");
   const header = Buffer.alloc(8);
   header.writeUInt32LE(op, 0);
   header.writeUInt32LE(body.length, 4);
   return Buffer.concat([header, body]);
}

/** Discord's frames are small. A larger length means the stream is out of step. */
const MAX_FRAME_BYTES = 1 << 20;

/** Splits the socket's byte stream back into frames. */
export class FrameReader {
   private pending: Buffer = Buffer.alloc(0);
   push(chunk: Buffer): Array<{ op: number; payload: unknown }> {
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      const frames: Array<{ op: number; payload: unknown }> = [];
      while (this.pending.length >= 8) {
         const op = this.pending.readUInt32LE(0);
         const length = this.pending.readUInt32LE(4);
         if (length > MAX_FRAME_BYTES) throw new Error(`Discord sent a ${length} byte frame`);
         if (this.pending.length < 8 + length) break;
         const body = this.pending.subarray(8, 8 + length).toString("utf8");
         this.pending = this.pending.subarray(8 + length);
         frames.push({ op, payload: JSON.parse(body) as unknown });
      }
      return frames;
   }
}

const messageSchema = z
   .object({
      cmd: z.string().optional(),
      evt: z.string().nullish(),
      code: z.number().optional(),
      message: z.string().optional(),
      data: z.object({ code: z.number().optional(), message: z.string().optional() }).loose().nullish(),
   })
   .loose();

export interface DiscordPresenceOptions {
   clientId: string;
   pid: number;
   /** Candidate sockets, tried in order. */
   paths: () => string[];
   log: (message: string, level?: "info" | "warn") => void;
   /** Whether a candidate is worth a connect. Windows pipes can't be checked for, so they always are. */
   exists?: (path: string) => boolean;
   /** How long to wait before looking for Discord again. */
   retryMs?: number;
   /** Discord allows 5 activity updates per 20 seconds. */
   minIntervalMs?: number;
}

/**
 * Keeps one activity on Discord through its local IPC socket. Nothing connects until there's an
 * activity to show, and clearing it closes the connection, which also clears it on Discord's side.
 * If Discord isn't running, it looks again every `retryMs` while an activity is wanted.
 */
export class DiscordPresence {
   private readonly options: Required<DiscordPresenceOptions>;
   private wanted: DiscordActivity | null = null;
   private wantedJson = "";
   private socket: Socket | null = null;
   private ready = false;
   private sentJson = "";
   private lastSentAt = 0;
   private retry: ReturnType<typeof setTimeout> | null = null;
   private flushTimer: ReturnType<typeof setTimeout> | null = null;
   /** Repeated failures log once until the next success. */
   private reported = new Set<string>();
   private closed = false;
   constructor(options: DiscordPresenceOptions) {
      this.options = {
         exists: process.platform === "win32" ? () => true : existsSync,
         retryMs: 30_000,
         minIntervalMs: 4_000,
         ...options,
      };
   }
   get connected(): boolean {
      return this.ready;
   }
   set(activity: DiscordActivity | null): void {
      if (this.closed) return;
      const json = activity ? JSON.stringify(activity) : "";
      if (json === this.wantedJson) return;
      this.wanted = activity;
      this.wantedJson = json;
      if (!activity) {
         this.disconnect();
         return;
      }
      if (!this.options.clientId) {
         this.report("no-client", "AcroClip has no Discord application ID, so its status stays off");
         return;
      }
      if (this.ready) this.flush();
      else if (!this.socket && !this.retry) this.connect();
   }
   close(): void {
      this.closed = true;
      this.wanted = null;
      this.wantedJson = "";
      this.disconnect();
   }
   private report(key: string, message: string, level: "info" | "warn" = "info"): void {
      if (this.reported.has(key)) return;
      this.reported.add(key);
      this.options.log(message, level);
   }
   private connect(): void {
      const candidates = this.options.paths().filter((path) => {
         try {
            return this.options.exists(path);
         } catch {
            return false;
         }
      });
      this.attempt(candidates, 0);
   }
   private attempt(candidates: string[], index: number): void {
      if (!this.wanted || this.closed) return;
      const path = candidates[index];
      if (path === undefined) {
         this.report("not-running", "Discord isn't running. AcroClip looks again while it has a status to show");
         this.scheduleRetry();
         return;
      }
      const socket = connect(path);
      this.socket = socket;
      const reader = new FrameReader();
      let opened = false;
      socket.once("connect", () => {
         opened = true;
         socket.write(encodeFrame(Op.Handshake, { v: 1, client_id: this.options.clientId }));
      });
      socket.on("data", (chunk: Buffer) => {
         try {
            for (const frame of reader.push(chunk)) this.receive(socket, frame.op, frame.payload);
         } catch (error) {
            this.report("bad-frame", `Discord's reply couldn't be read: ${error instanceof Error ? error.message : String(error)}`, "warn");
            socket.destroy();
         }
      });
      socket.on("error", () => undefined);
      socket.once("close", () => {
         if (this.socket !== socket) return;
         this.socket = null;
         const wasReady = this.ready;
         this.ready = false;
         this.sentJson = "";
         this.clearFlush();
         if (!opened) {
            // That socket was stale. The next one may belong to a running Discord.
            this.attempt(candidates, index + 1);
            return;
         }
         if (wasReady) this.options.log("disconnected from Discord");
         this.scheduleRetry();
      });
   }
   private receive(socket: Socket, op: number, payload: unknown): void {
      if (op === Op.Ping) {
         socket.write(encodeFrame(Op.Pong, payload));
         return;
      }
      const message = messageSchema.safeParse(payload);
      if (!message.success) return;
      if (op === Op.Close) {
         this.report(
            `closed:${message.data.code ?? ""}`,
            `Discord refused the connection: ${message.data.message ?? `code ${message.data.code ?? "unknown"}`}`,
            "warn"
         );
         socket.destroy();
         return;
      }
      if (op !== Op.Frame) return;
      if (message.data.evt === "READY") {
         this.ready = true;
         this.reported.clear();
         this.options.log("connected to Discord");
         this.flush();
      } else if (message.data.evt === "ERROR") {
         const detail = message.data.data?.message ?? `code ${message.data.data?.code ?? "unknown"}`;
         this.report(`error:${detail}`, `Discord rejected the status: ${detail}`, "warn");
      }
   }
   private flush(): void {
      if (!this.ready || !this.socket || !this.wanted || this.wantedJson === this.sentJson || this.flushTimer) return;
      const wait = this.lastSentAt + this.options.minIntervalMs - Date.now();
      if (wait > 0) {
         this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
         }, wait);
         this.flushTimer.unref?.();
         return;
      }
      this.socket.write(encodeFrame(Op.Frame, { cmd: "SET_ACTIVITY", args: { pid: this.options.pid, activity: this.wanted }, nonce: randomUUID() }));
      this.sentJson = this.wantedJson;
      this.lastSentAt = Date.now();
   }
   private scheduleRetry(): void {
      if (!this.wanted || this.closed || this.retry) return;
      this.retry = setTimeout(() => {
         this.retry = null;
         if (this.wanted && !this.socket) this.connect();
      }, this.options.retryMs);
      this.retry.unref?.();
   }
   private clearFlush(): void {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
   }
   private disconnect(): void {
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      this.clearFlush();
      const socket = this.socket;
      this.socket = null;
      this.ready = false;
      this.sentJson = "";
      // Discord clears an application's activity when its connection closes.
      socket?.destroy();
   }
}
