import { describe, expect, it } from "vitest";
import { createSliderMotion } from "./slider-motion";
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
      motion.to(10);
      tick(100);
      for (let frame = 1; frame < 100; frame++) {
         const target = frame < 50 ? frame + 10 : 100 - frame;
         for (let event = 0; event < 8; event++) motion.to(target);
         expect(queued.size).toBe(1);
         tick(100 + frame * 16);
         expect(paints.at(-1)).toBeGreaterThanOrEqual(0);
         expect(paints.at(-1)).toBeLessThanOrEqual(100);
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
      expect(paints.at(-1)).toBeGreaterThan(0);
      expect(paints.at(-1)).toBeLessThanOrEqual(100);
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
