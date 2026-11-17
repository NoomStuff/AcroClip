import { describe, expect, test, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameCatalog, parseCatalog, selectGame, type DetectedGame } from "./games";
import { applicationId } from "./application-identity";
import type { GameCandidate } from "../shared/types";

const candidate = (id: string, patch: Partial<GameCandidate> = {}): GameCandidate => ({
   id,
   name: "Game window",
   executable: "C:/Games/demo/game.exe",
   pid: 123,
   foreground: false,
   fullscreen: false,
   ...patch,
});
const detected = (id: string, patch: Partial<GameCandidate> = {}): DetectedGame => ({ ...candidate(id, patch), gameId: id, gameName: id });
describe("automatic game selection", () => {
   test("prefers the focused recognized game and retains it during an ordinary-app alt-tab", () => {
      const games = [detected("one", { fullscreen: true }), detected("two", { foreground: true })];
      expect(selectGame(games, "one", new Map())?.id).toBe("two");
      expect(
         selectGame(
            games.map((game) => ({ ...game, foreground: false })),
            "two",
            new Map()
         )?.id
      ).toBe("two");
   });
   test("follows another game only after it stays in front, so an alt-tab keeps the buffer", () => {
      const games = [detected("one"), detected("two", { foreground: true })];
      expect(selectGame(games, "one", new Map(), { id: "two", at: 10_000 }, 12_999)?.id).toBe("one");
      expect(selectGame(games, "one", new Map(), { id: "two", at: 10_000 }, 13_000)?.id).toBe("two");
      // Nothing to keep, so the game in front starts capture at once.
      expect(selectGame(games, null, new Map(), { id: "two", at: 10_000 }, 10_000)?.id).toBe("two");
      expect(selectGame([games[1]!], "one", new Map(), { id: "two", at: 10_000 }, 10_000)?.id).toBe("two");
   });
   test("uses previous game focus, then fullscreen, and waits with no games", () => {
      const games = [detected("one"), detected("two", { fullscreen: true })];
      expect(selectGame(games, null, new Map())?.id).toBe("two");
      expect(selectGame(games, null, new Map([["one", 123]]))?.id).toBe("one");
      expect(selectGame([], "old", new Map())).toBeUndefined();
   });
   test("excludes launchers, respects platform, arguments and exact custom executable paths", async () => {
      const file = join(await mkdtemp(join(tmpdir(), "acroclip-games-")), "catalog.json");
      const entries = [
         { id: "game", name: "Demo", executables: [{ name: "demo/game.exe", os: process.platform }] },
         { id: "launcher", name: "Launcher", executables: [{ name: "launcher.exe", os: process.platform, is_launcher: true }] },
         { id: "wrong-os", name: "Wrong OS", executables: [{ name: "other.exe", os: "not-this-platform" }] },
         { id: "java", name: "Java game", executables: [{ name: "java.exe", os: process.platform, arguments: "game.jar" }] },
         { id: "ambiguous", name: "Other Demo", executables: [{ name: "shared.exe", os: process.platform }] },
         { id: "ambiguous2", name: "Second Demo", executables: [{ name: "shared.exe", os: process.platform }] },
      ];
      await writeFile(file, JSON.stringify({ format: 2, entries, updated: Date.now() }));
      const catalog = new GameCatalog(file);
      await catalog.load();
      const candidates = [
         candidate("game"),
         candidate("launcher", { executable: "C:/launcher.exe" }),
         candidate("wrong-os", { executable: "C:/other.exe" }),
         candidate("java", { executable: "C:/java.exe" }),
         candidate("shared", { executable: "C:/shared.exe" }),
         candidate("custom", { executable: "C:/custom/game.exe" }),
      ];
      expect(catalog.match(candidates, []).map((game) => game.id)).toEqual(["game"]);
      expect(catalog.match(candidates, [{ executable: "c:\\custom\\GAME.EXE", name: "My game" }]).map((game) => game.id)).toEqual(["game", "custom"]);
      expect(catalog.match([candidate("java", { executable: "C:/java.exe", arguments: "-jar game.jar" })], [])[0]?.gameName).toBe("Java game");
   });
   test("rejects empty or corrupt replacement catalogs", () => {
      expect(() => parseCatalog({})).toThrow();
      expect(() => parseCatalog([{ id: "bad", name: "Bad", executables: [{ name: "exe" }] }])).toThrow();
   });
   test("matches Windows catalog entries only for verified Wine candidates on Linux", async () => {
      const file = join(await mkdtemp(join(tmpdir(), "acroclip-wine-games-")), "catalog.json");
      await writeFile(
         file,
         JSON.stringify({
            format: 2,
            updated: Date.now(),
            entries: [
               { id: "windows-game", name: "Windows demo", executables: [{ name: "demo/game.exe", os: "win32" }] },
               { id: "native-game", name: "Native demo", executables: [{ name: "demo/game.exe", os: "linux" }] },
               { id: "wine-loader", name: "Loader", executables: [{ name: "wine64", os: "linux", is_launcher: true }] },
            ],
         })
      );
      const catalog = new GameCatalog(file, undefined, "linux");
      await catalog.load();
      expect(
         catalog.match([candidate("wine", { executable: "/games/demo/game.exe", runtime: "wine", runtimeExecutable: "/usr/bin/wine64" })], [])[0]?.gameName
      ).toBe("Windows demo");
      expect(catalog.match([candidate("native", { executable: "/games/demo/game.exe" })], [])[0]?.gameName).toBe("Native demo");
      expect(catalog.match([candidate("loader", { executable: "/usr/bin/wine64", arguments: "/games/demo/game.exe" })], [])).toEqual([]);
   });
});

test("catalogue views use saved platform entries without downloading and share an in-flight local load", async () => {
   const folder = await mkdtemp(join(tmpdir(), "acroclip-game-list-"));
   const file = join(folder, "games.json");
   await writeFile(
      file,
      JSON.stringify({
         format: 2,
         updated: Date.now(),
         entries: [
            {
               id: "game",
               name: "Local game",
               executables: [
                  { name: ">demo/game.exe", os: "win32" },
                  { name: "game-helper.exe", os: "win32", is_launcher: true },
                  { name: "game-linux", os: "linux" },
               ],
            },
            { id: "game", name: "Local game", executables: [{ name: "game-alt.exe", os: "win32" }] },
            { id: "other", name: "Other OS", executables: [{ name: "other", os: "darwin" }] },
         ],
      })
   );
   const fetch = vi.spyOn(globalThis, "fetch");
   try {
      const catalog = new GameCatalog(file, undefined, "win32");
      const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
      expect(first).toEqual({ source: "saved", entries: [{ id: "game", name: "Local game", executables: ["demo/game.exe", "game-alt.exe"] }] });
      expect(second).toEqual(first);
      expect(fetch).not.toHaveBeenCalled();
      const fallback = await new GameCatalog(join(folder, "absent.json"), undefined, "win32").list();
      expect(fallback.source).toBe("built-in");
      expect(fallback.entries.find((entry) => entry.name === "Baldur's Gate 3")?.executables).toHaveLength(2);
   } finally {
      fetch.mockRestore();
   }
});

describe("catalog icons", () => {
   const hash = "67f35d9429ee338d6f2824163c1b773d";
   const downloaded = [
      { id: "356942674672091136", name: "Geometry Dash", executables: [{ name: "geometrydash.exe", os: "win32" }], icon_hash: hash },
      { id: "2", name: "Odd icon", executables: [{ name: "odd.exe", os: "win32" }], icon_hash: "../../evil" },
      { id: "3", name: "No icon", executables: [{ name: "none.exe", os: "win32" }] },
   ];
   test("keeps Discord's icon hash and finds it by the application id clips use", async () => {
      const entries = parseCatalog(downloaded);
      expect(entries.map((entry) => entry.icon)).toEqual([hash, undefined, undefined]);
      const file = join(await mkdtemp(join(tmpdir(), "acroclip-game-icons-")), "catalog.json");
      await writeFile(file, JSON.stringify({ format: 2, updated: Date.now(), entries }));
      const catalog = new GameCatalog(file, undefined, "win32");
      await catalog.load();
      expect(catalog.icon(applicationId("C:/Games/geometrydash.exe", "356942674672091136"))).toEqual({ id: "356942674672091136", icon: hash });
      expect(catalog.icon(applicationId("C:/Games/odd.exe", "2"))).toBeUndefined();
      expect(catalog.icon(applicationId("C:/Games/geometrydash.exe"))).toBeUndefined();
   });
   test("downloads again once when the saved catalog predates icons", async () => {
      const folder = await mkdtemp(join(tmpdir(), "acroclip-game-icons-"));
      const stale = join(folder, "stale.json");
      const current = join(folder, "current.json");
      const saved = downloaded.map(({ id, name, executables }) => ({ id, name, executables }));
      await writeFile(stale, JSON.stringify({ updated: Date.now(), entries: saved }));
      await writeFile(current, JSON.stringify({ format: 2, updated: Date.now(), entries: saved }));
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(downloaded)));
      try {
         const fresh = new GameCatalog(current, undefined, "win32");
         await fresh.refresh();
         expect(fetch).not.toHaveBeenCalled();
         const catalog = new GameCatalog(stale, undefined, "win32");
         await catalog.load();
         expect(catalog.icon(applicationId("", "356942674672091136"))).toBeUndefined();
         await catalog.refresh();
         expect(fetch).toHaveBeenCalledTimes(1);
         expect(catalog.icon(applicationId("", "356942674672091136"))?.icon).toBe(hash);
         const reloaded = new GameCatalog(stale, undefined, "win32");
         await reloaded.refresh();
         expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
         fetch.mockRestore();
      }
   });
});
