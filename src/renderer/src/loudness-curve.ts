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
const smoothingSigma = 1.6;
const smoothingRadius = 4;
// This share of the clip sits at the baseline: the quieter half, roughly.
const quietShare = 0.45;
// Above 1 lifts peaks over middling moments, and leaves the baseline with zero slope.
const peakLift = 1.8;

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
   // A Gaussian blur rounds the outline without the steps a box average leaves.
   const kernel = Array.from({ length: smoothingRadius * 2 + 1 }, (_, index) => Math.exp(-((index - smoothingRadius) ** 2) / (2 * smoothingSigma ** 2)));
   const smoothed = resampled.map((_, index) => {
      let total = 0;
      let weight = 0;
      kernel.forEach((factor, offset) => {
         const value = resampled[index + offset - smoothingRadius];
         if (value === undefined) return;
         total += value * factor;
         weight += factor;
      });
      return total / weight;
   });
   const sorted = [...smoothed].sort((a, b) => a - b);
   const peak = sorted.at(-1)!;
   if (peak - sorted[Math.floor(sorted.length * 0.2)]! < minimumSpread) return null;
   // Everything up to the typical level reads as quiet, so only moments above it rise.
   // A clip that is loud most of the time keeps some room under its peak.
   const floor = Math.min(sorted[Math.floor(sorted.length * quietShare)]!, peak - minimumSpread / 2);
   const shaped = smoothed.map((value) => Math.max(0, Math.min(1, (value - floor) / (peak - floor))) ** peakLift);
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
