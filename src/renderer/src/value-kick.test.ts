import { describe, expect, it } from "vitest";
import { createValueKick, kickTransform } from "./value-kick";

function manualFrames() {
   let pending: FrameRequestCallback | null = null;
   let time = 0;
   return {
      scheduler: {
         request(callback: FrameRequestCallback) {
            pending = callback;
            return 1;
         },
         cancel() {
            pending = null;
         },
      },
      run(frames: number) {
         for (let index = 0; index < frames && pending; index++) {
            const callback = pending;
            pending = null;
            time += 1000 / 60;
            callback(time);
         }
      },
      get idle() {
         return pending === null;
      },
   };
}

const options = { strength: 1, limit: 1.4, lift: 3, grow: 0.06 };

describe("value kick", () => {
   it("moves in the direction of the change and settles back to rest", () => {
      const frames = manualFrames();
      const painted: number[] = [];
      const motion = createValueKick((offset) => painted.push(offset), frames.scheduler, options);
      motion.kick(1);
      frames.run(240);
      expect(Math.max(...painted)).toBeGreaterThan(0.8);
      expect(Math.max(...painted)).toBeLessThan(1.2);
      expect(painted.at(-1)).toBe(0);
      expect(frames.idle).toBe(true);
      motion.kick(-1);
      frames.run(6);
      expect(painted.at(-1)).toBeLessThan(0);
   });

   it("stacks quick kicks but never past the limit", () => {
      const frames = manualFrames();
      const painted: number[] = [];
      const motion = createValueKick((offset) => painted.push(offset), frames.scheduler, options);
      for (let index = 0; index < 20; index++) {
         motion.kick(1);
         frames.run(2);
      }
      expect(Math.max(...painted)).toBeGreaterThan(1);
      expect(Math.max(...painted)).toBeLessThanOrEqual(options.limit);
   });

   it("kicks a large jump as hard as the drag it replaces, capped at the limit", () => {
      const frames = manualFrames();
      const painted: number[] = [];
      const motion = createValueKick((offset) => painted.push(offset), frames.scheduler, options);
      motion.kick(1, 20);
      frames.run(240);
      expect(Math.max(...painted)).toBeGreaterThan(1.2);
      expect(Math.max(...painted)).toBeLessThanOrEqual(options.limit);
   });

   it("lifts up for an increase and grows either way", () => {
      expect(kickTransform(0, options)).toBe("");
      expect(kickTransform(1, options)).toBe("translateY(-3.00px) scale(1.0600)");
      expect(kickTransform(-0.5, options)).toBe("translateY(1.50px) scale(1.0300)");
   });
});
