import { describe, expect, it } from "vitest";
import { sameAsThumbnail } from "./frame-difference";

const size = 4;
const square = (color: [number, number, number]) => Array.from({ length: size * size }, () => [...color, 255]).flat();
// A grid of squares laid out the way a strip is: left to right, then top to bottom.
function grid(colors: [number, number, number][], columns: number) {
   const rows = Math.ceil(colors.length / columns);
   const pixels = new Array<number>(columns * size * rows * size * 4).fill(0);
   colors.forEach((color, frame) => {
      for (let y = 0; y < size; y++)
         for (let x = 0; x < size; x++) {
            const at = ((Math.floor(frame / columns) * size + y) * columns * size + (frame % columns) * size + x) * 4;
            pixels.splice(at, 4, ...color, 255);
         }
   });
   return pixels;
}

describe("sameAsThumbnail", () => {
   it("marks frames that match the thumbnail, across rows", () => {
      const strip = grid(
         [
            [200, 30, 30],
            [30, 30, 200],
            [205, 34, 28],
            [30, 200, 30],
            [198, 30, 30],
         ],
         3
      );
      expect(sameAsThumbnail(strip, square([200, 30, 30]), 5, 3, size)).toEqual([true, false, true, false, true]);
   });
   it("treats compression noise as the same picture and a real change as different", () => {
      expect(sameAsThumbnail(grid([[110, 110, 110]], 1), square([100, 100, 100]), 1, 1, size)).toEqual([true]);
      expect(sameAsThumbnail(grid([[140, 140, 140]], 1), square([100, 100, 100]), 1, 1, size)).toEqual([false]);
   });
});
