import { describe, expect, it } from "vitest";
import { gameSuggestions, storeGame } from "./game-suggestions";
import type { GameCandidate } from "./types";

const running = (executable: string, patch: Partial<GameCandidate> = {}): GameCandidate => ({
   id: `window:${executable.length}:0`,
   name: "Window",
   executable,
   pid: 1,
   foreground: false,
   fullscreen: false,
   ...patch,
});

describe("games the catalog doesn't know", () => {
   it("names a game from its store library folder", () => {
      expect(storeGame("D:\\SteamLibrary\\steamapps\\common\\White Knuckle\\WhiteKnuckle.exe")).toEqual({ store: "Steam", name: "White Knuckle" });
      expect(storeGame("C:/Program Files/Epic Games/Demo/Binaries/Win64/Demo-Win64-Shipping.exe")).toEqual({ store: "Epic Games", name: "Demo" });
      expect(storeGame("C:/Program Files/Discord/Discord.exe")).toBeUndefined();
   });
   it("skips store tools, recognized games, added games and repeats", () => {
      expect(storeGame("D:/steamapps/common/Demo/UnityCrashHandler64.exe")).toBeUndefined();
      expect(storeGame("D:/steamapps/common/Steamworks Shared/_CommonRedist/setup.exe")).toBeUndefined();
      const game = "D:/SteamLibrary/steamapps/common/Demo/Demo.exe";
      expect(gameSuggestions([running(game), running(game, { id: "window:2:0" })], []).map((item) => item.suggestedName)).toEqual(["Demo"]);
      expect(gameSuggestions([running(game, { gameName: "Demo" })], [])).toEqual([]);
      expect(gameSuggestions([running(game)], [{ name: "Demo", executable: game.replaceAll("/", "\\") }])).toEqual([]);
   });
});
