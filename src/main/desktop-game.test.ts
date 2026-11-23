import { describe, expect, it } from "vitest";
import { desktopGame, DesktopGameWatch, presenceDesktopGame } from "./desktop-game";
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

describe("crediting a desktop clip to the game that filled it", () => {
   type Pick = { id: string };
   const demo: Pick = { id: "demo" },
      other: Pick = { id: "other" };
   /** One sample every 5 seconds, the way the app watches, from `from` up to but not including `to`. */
   const during = (game: Pick | undefined, from: number, to: number): [number, Pick | undefined][] => {
      const steps: [number, Pick | undefined][] = [];
      for (let second = from; second < to; second += 5) steps.push([second * 1000, game]);
      return steps;
   };
   const watch = (keepSeconds: number, ...parts: [number, Pick | undefined][][]) => {
      const result = new DesktopGameWatch<Pick>(keepSeconds * 1000);
      for (const [at, current] of parts.flat()) result.record(at, current);
      return result;
   };
   it("takes the game that held most of the clip", () => {
      // 0-80 s Demo, 80-120 s nothing: two thirds.
      const log = watch(600, during(demo, 0, 80), during(undefined, 80, 120));
      expect(log.pick(0, 120_000, undefined)).toBe(demo);
   });
   it("needs a majority, unless the game was in front when the clip was saved", () => {
      // 40 s of 120 s is a third.
      const log = watch(600, during(undefined, 0, 80), during(demo, 80, 120));
      expect(log.pick(0, 120_000, undefined)).toBeUndefined();
      expect(log.pick(0, 120_000, demo)).toBe(demo);
      // Another game in front at the press doesn't earn the lower bar for this one.
      expect(log.pick(0, 120_000, other)).toBeUndefined();
      // A game that held a tenth of the clip never does, even when it is in front at the end.
      const brief = watch(600, during(undefined, 0, 108), during(demo, 108, 120));
      expect(brief.pick(0, 120_000, demo)).toBeUndefined();
   });
   it("picks the game with the most time when two share a clip", () => {
      const log = watch(600, during(demo, 0, 40), during(other, 40, 110));
      expect(log.pick(0, 110_000, other)).toBe(other);
      expect(log.pick(0, 110_000, demo)).toBe(other);
   });
   it("only looks at the footage in the clip and ignores time before it", () => {
      const log = watch(600, during(demo, 0, 120), during(undefined, 120, 240));
      expect(log.pick(120_000, 240_000, undefined)).toBeUndefined();
      expect(log.pick(0, 120_000, undefined)).toBe(demo);
   });
   it("counts only the time it has watched, and treats a long silence as unknown", () => {
      // Watching began 90 s into a 120 s clip and saw Demo for all of it.
      expect(watch(600, during(demo, 90, 120)).pick(0, 120_000, undefined)).toBe(demo);
      // A single sample doesn't prove the game stayed up for the next minute.
      expect(watch(600, during(demo, 0, 5)).pick(0, 120_000, undefined)).toBeUndefined();
   });
   it("falls back to what is on screen when nothing was watched, and forgets on clear", () => {
      const log = new DesktopGameWatch<Pick>(600_000);
      expect(log.pick(0, 120_000, demo)).toBe(demo);
      expect(log.pick(0, 120_000, undefined)).toBeUndefined();
      log.record(0, demo);
      log.clear();
      expect(log.pick(0, 120_000, undefined)).toBeUndefined();
   });
   it("forgets samples older than it keeps", () => {
      // Demo for the first nine minutes, then a minute of nothing, with only a minute kept.
      const log = watch(60, during(demo, 0, 540), during(undefined, 540, 600));
      expect(log.pick(0, 600_000, undefined)).toBeUndefined();
      const all = watch(600, during(demo, 0, 540), during(undefined, 540, 600));
      expect(all.pick(0, 600_000, undefined)).toBe(demo);
   });
});

describe("the game a desktop capture's status names", () => {
   const deadlock = { id: "deadlock" };
   const limbus = { id: "limbus" };
   it("names the game in front", () => {
      expect(presenceDesktopGame(limbus, deadlock, [deadlock, limbus])).toBe(limbus);
   });
   it("keeps the last game while it's open behind something else, like Discord", () => {
      expect(presenceDesktopGame(undefined, deadlock, [deadlock, limbus])).toBe(deadlock);
   });
   it("moves to the one game still open once the last one closes", () => {
      expect(presenceDesktopGame(undefined, deadlock, [limbus, limbus])).toBe(limbus);
   });
   it("names nothing when several are open and none is in front", () => {
      expect(presenceDesktopGame(undefined, undefined, [deadlock, limbus])).toBeUndefined();
      expect(presenceDesktopGame(undefined, undefined, [])).toBeUndefined();
   });
});
