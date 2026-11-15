import { describe, expect, it } from "vitest";
import { desktopGame } from "./desktop-game";
import type { GameCandidate } from "../shared/types";

const game = (patch: Partial<GameCandidate> = {}): GameCandidate => ({
   id: "window:1:0",
   name: "Demo",
   executable: "C:/Games/Demo/demo.exe",
   pid: 1,
   foreground: true,
   fullscreen: true,
   gameId: "123",
   gameName: "Demo",
   ...patch,
});
const left = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const right = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };

describe("the game in a desktop capture", () => {
   it("credits a recognized fullscreen game in front on the captured screen", () => {
      const monitor = { left: 0, top: 0, right: 1920, bottom: 1080 };
      expect(desktopGame([game({ monitor })], left, 2)?.gameName).toBe("Demo");
      expect(desktopGame([game({ monitor })], right, 2)).toBeUndefined();
   });
   it("leaves the clip as Desktop when the game isn't clearly what's on screen", () => {
      expect(desktopGame([game({ foreground: false })], left, 1)).toBeUndefined();
      expect(desktopGame([game({ fullscreen: false })], left, 1)).toBeUndefined();
      const unrecognized = game();
      delete unrecognized.gameId;
      delete unrecognized.gameName;
      expect(desktopGame([unrecognized], left, 1)).toBeUndefined();
      // Without monitor details only one display is unambiguous.
      expect(desktopGame([game()], left, 1)?.gameName).toBe("Demo");
      expect(desktopGame([game()], left, 2)).toBeUndefined();
   });
});
