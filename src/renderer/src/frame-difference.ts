/** Each frame and the thumbnail shrink to this many pixels a side before they are compared. */
export const signatureSize = 16;
/**
 * The average difference per color channel, out of 255, below which two shrunken frames count as
 * the same picture. Compression noise and small motion stay well under it, a cut or a camera move
 * goes well over.
 */
export const sameFrameLimit = 12;

/**
 * Which strip frames show the same picture as the thumbnail. The strip is shrunk to a grid of
 * signatureSize squares, one per frame, and the thumbnail to a single square, both as RGBA.
 */
export function sameAsThumbnail(strip: ArrayLike<number>, thumbnail: ArrayLike<number>, frames: number, columns: number, size = signatureSize): boolean[] {
   const rowWidth = columns * size * 4;
   return Array.from({ length: frames }, (_, frame) => {
      const left = (frame % columns) * size * 4;
      const top = Math.floor(frame / columns) * size;
      let total = 0;
      for (let y = 0; y < size; y++)
         for (let x = 0; x < size; x++) {
            const at = (top + y) * rowWidth + left + x * 4;
            const from = (y * size + x) * 4;
            for (let channel = 0; channel < 3; channel++) total += Math.abs(strip[at + channel]! - thumbnail[from + channel]!);
         }
      return total / (size * size * 3) < sameFrameLimit;
   });
}
