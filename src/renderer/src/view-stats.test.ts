import { describe, expect, it } from "vitest";
import { startWatch, watchEvent, watchSeek, watchTick } from "./view-stats";

const play = (session: ReturnType<typeof startWatch>, from: number, to: number, step = 0.25) => {
   for (let time = from; time <= to + 1e-9; time += step) watchTick(session, Math.round(time * 100) / 100);
};

describe("watch sessions", () => {
   it("credits steady playback and every slice it passes", () => {
      const session = startWatch("a", 32);
      play(session, 0, 31.9);
      expect(session.seconds).toBeCloseTo(31.75, 1);
      expect(session.watched.every((count) => count === 1)).toBe(true);
      expect(session.completed).toBe(true);
   });
   it("counts a rewatched moment twice without crediting skipped time", () => {
      const session = startWatch("a", 32);
      play(session, 0, 10);
      watchSeek(session);
      play(session, 4, 6);
      expect(session.seconds).toBeCloseTo(12, 1);
      expect(session.watched.slice(4, 7)).toEqual([2, 2, 2]);
      expect(session.watched[20]).toBe(0);
      expect(session.completed).toBe(false);
   });
   it("treats an unannounced jump as a new pass", () => {
      const session = startWatch("a", 32);
      play(session, 0, 3);
      watchTick(session, 20);
      expect(session.seconds).toBeCloseTo(3, 1);
      expect(session.watched[20]).toBe(1);
   });
   it("skips sessions shorter than a second", () => {
      const session = startWatch("a", 10);
      play(session, 0, 0.5);
      expect(watchEvent(session)).toBeNull();
      play(session, 0.75, 4);
      expect(watchEvent(session)).toMatchObject({ type: "view", clipId: "a", seconds: 4, completed: false });
   });
});
