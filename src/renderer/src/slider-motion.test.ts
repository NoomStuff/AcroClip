import { describe, expect, it } from "vitest";
import { createSliderMotion, createHoverMotion } from "./slider-motion";
function fixture() {
   let serial = 0;
   const queued = new Map<number, FrameRequestCallback>(),
      paints: number[] = [];
   const motion = createSliderMotion(0, (value) => paints.push(value), {
      request(callback) {
         queued.set(++serial, callback);
         return serial;
      },
      cancel(frame) {
         queued.delete(frame);
      },
   });
   const tick = (time: number) => {
      const callbacks = [...queued.values()];
      queued.clear();
      callbacks.forEach((callback) => callback(time));
   };
   return { motion, queued, paints, tick };
}
describe("continuous slider motion", () => {
   it("retains one loop and elapsed time through 500 Hz target updates", () => {
      const { motion, queued, paints, tick } = fixture();
      let expected = 0;
      motion.to(10);
      tick(100);
      for (let frame = 1; frame < 100; frame++) {
         const target = frame < 50 ? frame + 10 : 100 - frame;
         for (let event = 0; event < 8; event++) motion.to(target);
         expect(queued.size).toBe(1);
         tick(100 + frame * 16);
         expected += (target - expected) * (1 - Math.exp(-18 * 0.016));
         if (Math.abs(target - expected) < 0.01) expected = target;
         expect(paints.at(-1)).toBeCloseTo(expected, 9);
      }
      motion.to(30);
      for (let frame = 100; queued.size; frame++) tick(100 + frame * 16);
      expect(paints.at(-1)).toBe(30);
      const count = paints.length;
      tick(5000);
      expect(paints).toHaveLength(count);
   });
   it("settles, handles a stalled frame, jumps for reduced motion and cancels on disposal", () => {
      const { motion, queued, paints, tick } = fixture();
      motion.to(100);
      tick(0);
      tick(10000);
      expect(paints.at(-1)).toBeCloseTo(100 * (1 - Math.exp(-1.8)), 8);
      motion.to(20, true);
      expect(paints.at(-1)).toBe(20);
      expect(queued.size).toBe(0);
      motion.to(70);
      expect(queued.size).toBe(1);
      motion.dispose();
      expect(queued.size).toBe(0);
      tick(10100);
      motion.to(10);
      expect(paints.at(-1)).toBe(20);
      expect(queued.size).toBe(0);
   });
});

describe("slider hover spring", () => {
   it("retains velocity through interruptions with bounded overshoot and settles", () => {
      const queued = new Map<number, FrameRequestCallback>();
      let serial = 0;
      const paints: number[] = [];
      const motion = createHoverMotion(0, (value) => paints.push(value), {
         request: (callback) => {
            queued.set(++serial, callback);
            return serial;
         },
         cancel: (frame) => {
            queued.delete(frame);
         },
      });
      const tick = (time: number) => {
         const callbacks = [...queued.values()];
         queued.clear();
         callbacks.forEach((callback) => callback(time));
      };
      motion.to(0.6);
      tick(0);
      for (let i = 1; i < 50; i++) {
         motion.to(i < 12 ? 0.6 : i < 18 ? 0 : 0.6);
         expect(queued.size).toBeLessThanOrEqual(1);
         tick(i * 16);
      }
      expect(Math.max(...paints)).toBeGreaterThan(0.6);
      expect(paints.every((value) => value >= 0 && value <= 1.08)).toBe(true);
      for (let i = 50; queued.size && i < 200; i++) tick(i * 16);
      expect(paints.at(-1)).toBe(0.6);
      motion.to(0, true);
      expect(paints.at(-1)).toBe(0);
      expect(queued.size).toBe(0);
      motion.dispose();
   });
});
