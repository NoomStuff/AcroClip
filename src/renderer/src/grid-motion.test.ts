import { describe, expect, it } from "vitest";
import { createGridMotion, paintGridCard, paintGridThumbnail } from "./grid-motion";
import type { GridPoint, GridRect, GridCardStyle, GridThumbnailStyle } from "./grid-motion";

function fixture() {
   let serial = 0;
   const frames = new Map<number, FrameRequestCallback>();
   const offsets = new Map<string, GridPoint>();
   const sizes = new Map<string, GridRect>();
   const styles = new Map<string, GridCardStyle>();
   const motion = createGridMotion<string>(
      (key, offset, current, target) => {
         offsets.set(key, offset);
         if (current) sizes.set(key, { ...current });
         let style = styles.get(key);
         if (!style) {
            style = {
               transform: "",
               width: "",
               height: "",
               removeProperty(name) {
                  if (name === "transform" || name === "width" || name === "height") {
                     const old = this[name];
                     this[name] = "";
                     return old;
                  }
                  return "";
               },
            };
            styles.set(key, style);
         }
         paintGridCard(style, offset, current, target);
      },
      {
         request(callback) {
            frames.set(++serial, callback);
            return serial;
         },
         cancel(frame) {
            frames.delete(frame);
         },
      }
   );
   const tick = (time: number) => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(time);
   };
   return { motion, offsets, frames, tick, sizes, styles };
}

describe("continuous grid movement", () => {
   it("resizes thumbnails in layout pixels and releases list flex sizing afterwards", () => {
      const style: GridThumbnailStyle = {
         width: "",
         height: "",
         flexBasis: "",
         removeProperty(name) {
            if (name === "flex-basis") {
               const previous = this.flexBasis;
               this.flexBasis = "";
               return previous;
            }
            if (name === "width" || name === "height") {
               const previous = this[name];
               this[name] = "";
               return previous;
            }
            return "";
         },
      };
      const before = { left: 0, top: 0, width: 128, height: 72 };
      const after = { left: 0, top: 0, width: 400, height: 225 };
      paintGridThumbnail(style, before, after);
      expect(style.width).toBe("128px");
      expect(style.height).toBe("72px");
      expect(style.flexBasis).toBe("128px");
      paintGridThumbnail(style, after, after);
      expect(style.width).toBe("");
      expect(style.height).toBe("");
      expect(style.flexBasis).toBe("");
   });
   it("preserves the visible size and position when zoom changes mid-animation", () => {
      const { motion, offsets, frames, tick, sizes, styles } = fixture();
      motion.to("clip", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("clip", { left: 100, top: 60, width: 400, height: 300 });
      expect(offsets.get("clip")).toEqual({ left: -100, top: -60 });
      expect(styles.get("clip")!.width).toBe("200px");
      expect(styles.get("clip")!.height).toBe("150px");
      expect(styles.get("clip")!.transform).not.toContain("scale");
      tick(0);
      tick(16);
      const before = offsets.get("clip")!;
      const width = sizes.get("clip")!.width;
      const height = sizes.get("clip")!.height;
      const left = 100 + before.left;
      motion.to("clip", { left: 40, top: 20, width: 250, height: 190 });
      const after = offsets.get("clip")!;
      expect(sizes.get("clip")!.width).toBeCloseTo(width);
      expect(sizes.get("clip")!.height).toBeCloseTo(height);
      expect(40 + after.left).toBeCloseTo(left);
      expect(frames.size).toBe(1);
      for (let time = 32; frames.size; time += 16) tick(time);
      expect(offsets.get("clip")).toEqual({ left: 0, top: 0 });
   });
   it("animates size changes even when the tile stays in the same position", () => {
      const { motion, sizes, frames, tick } = fixture();
      motion.to("clip", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("clip", { left: 0, top: 0, width: 400, height: 300 });
      expect(sizes.get("clip")!.width).toBe(200);
      expect(frames.size).toBe(1);
      tick(0);
      tick(16);
      expect(sizes.get("clip")!.width).toBeGreaterThan(200);
      expect(sizes.get("clip")!.width).toBeLessThan(400);
   });
   it("retargets from the visible position without resetting the frame clock", () => {
      const { motion, offsets, frames, tick } = fixture();
      motion.to("clip", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("clip", { left: 100, top: 100, width: 200, height: 150 });
      tick(0);
      tick(16);
      const before = 100 + offsets.get("clip")!.left;
      motion.to("clip", { left: 200, top: 200, width: 200, height: 150 });
      expect(200 + offsets.get("clip")!.left).toBeCloseTo(before);
      expect(frames.size).toBe(1);
      tick(32);
      expect(200 + offsets.get("clip")!.left).toBeGreaterThan(before);
      expect(200 + offsets.get("clip")!.left).toBeLessThan(200);
   });
   it("keeps one loop during repeated updates and reverses without a position jump", () => {
      const { motion, offsets, frames, tick } = fixture();
      motion.to("clip", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("clip", { left: 400, top: 0, width: 200, height: 150 });
      tick(0);
      tick(16);
      let visual = 400 + offsets.get("clip")!.left;
      for (let update = 1; update <= 100; update++) {
         const target = update < 50 ? 400 + update : 0;
         motion.to("clip", { left: target, top: 0, width: 200, height: 150 });
         expect(target + offsets.get("clip")!.left).toBeCloseTo(visual);
         expect(frames.size).toBe(1);
         tick(16 + update * 2);
         visual = target + offsets.get("clip")!.left;
         expect(visual).toBeGreaterThanOrEqual(0);
      }
      for (let time = 240; frames.size; time += 16) tick(time);
      expect(offsets.get("clip")).toEqual({ left: 0, top: 0 });
   });
   it("releases removed elements and cancels all motion when cleared", () => {
      const { motion, offsets, frames } = fixture();
      motion.to("first", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("first", { left: 100, top: 0, width: 200, height: 150 });
      motion.to("second", { left: 0, top: 0, width: 200, height: 150 }, true);
      motion.retain(new Set(["second"]));
      expect(offsets.get("first")).toEqual({ left: 0, top: 0 });
      expect(motion.offset("first")).toEqual({ left: 0, top: 0 });
      motion.clear();
      expect(offsets.get("second")).toEqual({ left: 0, top: 0 });
      expect(frames.size).toBe(0);
      motion.to("first", { left: 200, top: 200, width: 200, height: 150 });
      expect(frames.size).toBe(0);
   });
   it("places offscreen elements immediately without scheduling animation", () => {
      const { motion, offsets, frames } = fixture();
      motion.to("clip", { left: 0, top: 0, width: 200, height: 150 });
      motion.to("clip", { left: 100, top: 100, width: 200, height: 150 }, true, true);
      expect(offsets.get("clip")).toEqual({ left: 0, top: 0 });
      expect(frames.size).toBe(0);
   });
});
