import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscordPresence, FrameReader, Op, discordGameIcon, discordIpcPaths, encodeFrame, presenceActivity } from "./discord-presence";
import type { DiscordActivity } from "./discord-presence";

const valorantGame = { name: "Valorant", icon: "https://cdn.discordapp.com/app-icons/1/a.png?size=512" };

describe("presenceActivity", () => {
   it("shows the captured game as itself, with AcroClip as a badge, at the minimal level", () => {
      expect(presenceActivity({ level: "minimal", capturing: true, game: valorantGame, since: 1000 })).toEqual({
         type: 0,
         name: "Valorant",
         status_display_type: 0,
         details: "Clipping with AcroClip",
         timestamps: { start: 1000 },
         assets: { large_image: valorantGame.icon, large_text: "Valorant", small_image: "logo", small_text: "AcroClip" },
         buttons: [{ label: "Get AcroClip", url: "https://acroclip.noomstuff.com/drpc" }],
         instance: false,
      });
   });
   it("names AcroClip in the status itself at the full level", () => {
      const activity = presenceActivity({ level: "full", capturing: true, game: valorantGame, since: 1000 });
      expect(activity).toMatchObject({ name: "Valorant with AcroClip", assets: { large_text: "Valorant", small_image: "logo" } });
      expect(activity).not.toHaveProperty("details");
   });
   it("uses AcroClip's logo for a game without a catalog icon", () => {
      expect(presenceActivity({ level: "minimal", capturing: true, game: { name: "My game" }, since: 1 })).toMatchObject({
         name: "My game",
         assets: { large_image: "logo", large_text: "AcroClip" },
      });
   });
   it("leaves the status alone without a game being captured", () => {
      for (const level of ["minimal", "full"] as const) {
         expect(presenceActivity({ level, capturing: true, game: undefined, since: 1000 })).toBeNull();
         expect(presenceActivity({ level, capturing: false, game: valorantGame, since: undefined })).toBeNull();
      }
   });
   it("never shows anything when off", () => {
      expect(presenceActivity({ level: "off", capturing: true, game: valorantGame, since: 1000 })).toBeNull();
   });
   it("keeps names inside Discord's 2 to 128 characters", () => {
      expect(presenceActivity({ level: "minimal", capturing: true, game: { name: " X " }, since: 1 })).toBeNull();
      const long = { name: "a".repeat(200) };
      expect(presenceActivity({ level: "minimal", capturing: true, game: long, since: 1 })?.name).toHaveLength(128);
      const full = presenceActivity({ level: "full", capturing: true, game: long, since: 1 })?.name;
      expect(full).toHaveLength(128);
      expect(full).toMatch(/… with AcroClip$/);
   });
   it("points at Discord's copy of a catalog game's icon", () => {
      expect(discordGameIcon("356942674672091136", "67f35d9429ee338d6f2824163c1b773d")).toBe(
         "https://cdn.discordapp.com/app-icons/356942674672091136/67f35d9429ee338d6f2824163c1b773d.png?size=512"
      );
   });
});

describe("discordIpcPaths", () => {
   it("tries the ten numbered pipes on Windows", () => {
      const paths = discordIpcPaths("win32", {});
      expect(paths).toHaveLength(10);
      expect(paths[0]).toBe("\\\\?\\pipe\\discord-ipc-0");
   });
   it("covers the runtime folder, Flatpak and Snap on Linux", () => {
      const paths = discordIpcPaths("linux", { XDG_RUNTIME_DIR: "/run/user/1000" });
      expect(paths[0]).toBe("/run/user/1000/discord-ipc-0");
      expect(paths).toContain("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0");
      expect(paths).toContain("/run/user/1000/snap.discord/discord-ipc-0");
      expect(paths).toContain("/tmp/discord-ipc-9");
   });
});

describe("FrameReader", () => {
   it("joins frames split across chunks and splits frames sharing one", () => {
      const reader = new FrameReader();
      const both = Buffer.concat([encodeFrame(Op.Frame, { evt: "READY" }), encodeFrame(Op.Ping, { n: 1 })]);
      expect(reader.push(both.subarray(0, 5))).toEqual([]);
      expect(reader.push(both.subarray(5))).toEqual([
         { op: Op.Frame, payload: { evt: "READY" } },
         { op: Op.Ping, payload: { n: 1 } },
      ]);
   });
   it("refuses a length no Discord frame has", () => {
      const header = Buffer.alloc(8);
      header.writeUInt32LE(1, 0);
      header.writeUInt32LE(0xffffffff, 4);
      expect(() => new FrameReader().push(header)).toThrow();
   });
});

interface FakeDiscord {
   path: string;
   server: Server;
   frames: Array<{ op: number; payload: Record<string, unknown> }>;
   clients: Socket[];
}
const folders: string[] = [];
const servers: Server[] = [];
const presences: DiscordPresence[] = [];
afterEach(async () => {
   for (const presence of presences.splice(0)) presence.close();
   await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
   for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function socketPath(name: string): string {
   if (process.platform === "win32") return `\\\\?\\pipe\\acroclip-test-${process.pid}-${name}-${Date.now()}`;
   const folder = mkdtempSync(join(tmpdir(), "acroclip-discord-"));
   folders.push(folder);
   return join(folder, "discord-ipc-0");
}
/** Answers like the Discord client: READY after the handshake, and a reply to every command. */
async function fakeDiscord(options: { refuse?: boolean; pingFirst?: boolean } = {}): Promise<FakeDiscord> {
   const path = socketPath("server");
   const fake: FakeDiscord = { path, server: createServer(), frames: [], clients: [] };
   fake.server.on("connection", (socket) => {
      fake.clients.push(socket);
      const reader = new FrameReader();
      socket.on("data", (chunk: Buffer) => {
         for (const frame of reader.push(chunk)) {
            const payload = frame.payload as Record<string, unknown>;
            fake.frames.push({ op: frame.op, payload });
            if (frame.op === Op.Handshake) {
               if (options.refuse) {
                  socket.end(encodeFrame(Op.Close, { code: 4000, message: "Invalid Client ID" }));
                  continue;
               }
               if (options.pingFirst) socket.write(encodeFrame(Op.Ping, { beat: 1 }));
               socket.write(encodeFrame(Op.Frame, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
            } else if (frame.op === Op.Frame) socket.write(encodeFrame(Op.Frame, { cmd: payload["cmd"], nonce: payload["nonce"], evt: null, data: {} }));
         }
      });
      socket.on("error", () => undefined);
   });
   servers.push(fake.server);
   await new Promise<void>((resolve) => fake.server.listen(path, resolve));
   return fake;
}
function presenceFor(paths: string[], logs: string[] = [], overrides: { minIntervalMs?: number; retryMs?: number } = {}): DiscordPresence {
   const presence = new DiscordPresence({
      clientId: "1234",
      pid: 42,
      paths: () => paths,
      log: (message) => logs.push(message),
      exists: () => true,
      minIntervalMs: 0,
      retryMs: 50,
      ...overrides,
   });
   presences.push(presence);
   return presence;
}
async function until(check: () => boolean, ms = 2000): Promise<void> {
   const start = Date.now();
   while (!check()) {
      if (Date.now() - start > ms) throw new Error("Timed out");
      await new Promise((resolve) => setTimeout(resolve, 5));
   }
}
const activities = (fake: FakeDiscord) =>
   fake.frames.filter((frame) => frame.op === Op.Frame).map((frame) => (frame.payload["args"] as { activity: DiscordActivity | null }).activity);
const valorant = presenceActivity({ level: "minimal", capturing: true, game: valorantGame, since: 1 })!;
const celeste = presenceActivity({ level: "minimal", capturing: true, game: { name: "Celeste" }, since: 2 })!;

describe("DiscordPresence", () => {
   it("handshakes with the client ID, then sets the activity for this process", async () => {
      const fake = await fakeDiscord();
      const presence = presenceFor([fake.path]);
      presence.set(valorant);
      await until(() => activities(fake).length === 1);
      expect(fake.frames[0]).toEqual({ op: Op.Handshake, payload: { v: 1, client_id: "1234" } });
      const command = fake.frames[1]!.payload;
      expect(command).toMatchObject({ cmd: "SET_ACTIVITY", args: { pid: 42, activity: valorant } });
      expect(typeof command["nonce"]).toBe("string");
      expect(presence.connected).toBe(true);
   });
   it("sends nothing for a repeat and spaces updates out", async () => {
      const fake = await fakeDiscord();
      const presence = presenceFor([fake.path], [], { minIntervalMs: 150 });
      presence.set(valorant);
      await until(() => activities(fake).length === 1);
      presence.set({ ...valorant });
      presence.set(celeste);
      const changed = Date.now();
      await until(() => activities(fake).length === 2);
      expect(Date.now() - changed).toBeGreaterThanOrEqual(100);
      expect(activities(fake)).toEqual([valorant, celeste]);
   });
   it("closes the connection when there's nothing to show", async () => {
      const fake = await fakeDiscord();
      const presence = presenceFor([fake.path]);
      presence.set(valorant);
      await until(() => presence.connected);
      presence.set(null);
      await until(() => fake.clients.every((client) => client.destroyed || client.readableEnded));
      expect(presence.connected).toBe(false);
   });
   it("answers Discord's pings", async () => {
      const fake = await fakeDiscord({ pingFirst: true });
      presenceFor([fake.path]).set(valorant);
      await until(() => fake.frames.some((frame) => frame.op === Op.Pong));
      expect(fake.frames.find((frame) => frame.op === Op.Pong)?.payload).toEqual({ beat: 1 });
   });
   it("skips a stale socket and connects to the next one", async () => {
      const fake = await fakeDiscord();
      const presence = presenceFor([socketPath("stale"), fake.path]);
      presence.set(valorant);
      await until(() => activities(fake).length === 1);
   });
   it("finds Discord once it starts, and sets the activity again after it restarts", async () => {
      const logs: string[] = [];
      const path = socketPath("later");
      const presence = presenceFor([path], logs);
      presence.set(valorant);
      await until(() => logs.some((line) => line.includes("isn't running")));
      const server = createServer();
      servers.push(server);
      const frames: number[] = [];
      server.on("connection", (socket) => {
         const reader = new FrameReader();
         socket.on("data", (chunk: Buffer) => {
            for (const frame of reader.push(chunk)) {
               frames.push(frame.op);
               if (frame.op === Op.Handshake) socket.write(encodeFrame(Op.Frame, { evt: "READY" }));
               if (frame.op === Op.Frame) socket.destroy();
            }
         });
      });
      await new Promise<void>((resolve) => server.listen(path, resolve));
      // Discord drops the connection after the first activity. AcroClip reconnects and sends it again.
      await until(() => frames.filter((op) => op === Op.Frame).length >= 2);
      expect(frames.filter((op) => op === Op.Handshake).length).toBeGreaterThanOrEqual(2);
      expect(logs.filter((line) => line.includes("isn't running"))).toHaveLength(1);
   });
   it("reports a refused client ID once and keeps trying", async () => {
      const logs: string[] = [];
      const fake = await fakeDiscord({ refuse: true });
      presenceFor([fake.path], logs).set(valorant);
      await until(() => fake.frames.filter((frame) => frame.op === Op.Handshake).length >= 3);
      expect(logs.filter((line) => line.includes("Invalid Client ID"))).toHaveLength(1);
      expect(activities(fake)).toEqual([]);
   });
   it("stays off without an application ID", async () => {
      const fake = await fakeDiscord();
      const logs: string[] = [];
      const presence = new DiscordPresence({ clientId: "", pid: 1, paths: () => [fake.path], log: (line) => logs.push(line), exists: () => true });
      presences.push(presence);
      presence.set(valorant);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fake.frames).toEqual([]);
      expect(logs).toHaveLength(1);
   });
});
