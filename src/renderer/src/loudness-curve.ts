/** Loudness to show above the seek bar, shaped like a "most replayed" graph: 0 to 1, peak at 1. */
export interface LoudnessCurve {
   points: number[];
   // The filled area, and its top edge alone for an outline.
   path: string;
   line: string;
}

// Below about 7 dB between the quiet and loud parts there is no moment to point at,
// such as a clip carried by constant music. Exaggerating that would only draw noise.
const minimumSpread = 0.12;

/**
 * Smooths the envelope, scales it so the quiet floor sits at 0 and the loudest moment at 1,
 * and lifts the peaks so the moment stands out. Null for clips without a clear loud part.
 * Both paths sit in a 0 to 1000 by 0 to 100 box; the area fills it from the baseline up.
 */
export function loudnessCurve(levels: readonly number[], points = 120): LoudnessCurve | null {
   if (levels.length < 4) return null;
   const resampled = Array.from({ length: points }, (_, index) => {
      const from = Math.floor((index / points) * levels.length);
      const to = Math.max(from + 1, Math.floor(((index + 1) / points) * levels.length));
      return Math.max(...levels.slice(from, to));
   });
   const smoothed = resampled.map((_, index) => {
      const window = resampled.slice(Math.max(0, index - 2), index + 3);
      return window.reduce((total, value) => total + value, 0) / window.length;
   });
   const sorted = [...smoothed].sort((a, b) => a - b);
   const floor = sorted[Math.floor(sorted.length * 0.2)]!;
   const peak = sorted.at(-1)!;
   if (peak - floor < minimumSpread) return null;
   const shaped = smoothed.map((value) => Math.max(0, Math.min(1, (value - floor) / (peak - floor))) ** 1.6);
   // Curves through the midpoints between samples keep the outline smooth without overshooting.
   const x = (index: number) => (index / (points - 1)) * 1000;
   const y = (value: number) => 100 - value * 100;
   let edge = "";
   for (let index = 1; index < points; index++) {
      const midX = (x(index - 1) + x(index)) / 2;
      const midY = (y(shaped[index - 1]!) + y(shaped[index]!)) / 2;
      edge += `Q${x(index - 1).toFixed(1)} ${y(shaped[index - 1]!).toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
   }
   edge += `L1000 ${y(shaped.at(-1)!).toFixed(1)}`;
   const start = y(shaped[0]!).toFixed(1);
   return { points: shaped, path: `M0 100L0 ${start}${edge}L1000 100Z`, line: `M0 ${start}${edge}` };
}
