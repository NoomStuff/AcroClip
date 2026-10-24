// A small accent in an otherwise neutral icon should not tint the entire application.
export function sampleApplicationColor(pixels: Uint8ClampedArray): string | null {
   const buckets = Array.from({ length: 24 }, () => ({ weight: 0, x: 0, y: 0, saturation: 0 }));
   let visible = 0;
   let colorful = 0;
   for (let i = 0; i + 3 < pixels.length; i += 4) {
      const alpha = pixels[i + 3]! / 255;
      if (alpha < 0.5) continue;
      visible++;
      const r = pixels[i]! / 255,
         g = pixels[i + 1]! / 255,
         b = pixels[i + 2]! / 255;
      const max = Math.max(r, g, b),
         min = Math.min(r, g, b),
         chroma = max - min,
         lightness = (max + min) / 2;
      if (chroma < 0.12 || lightness < 0.14 || lightness > 0.88) continue;
      colorful++;
      const hue = ((max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60 + 360) % 360;
      const weight = alpha * chroma * (1 - Math.abs(lightness - 0.5));
      const bucket = buckets[Math.round(hue / 15) % buckets.length]!;
      bucket.weight += weight;
      bucket.x += Math.cos((hue * Math.PI) / 180) * weight;
      bucket.y += Math.sin((hue * Math.PI) / 180) * weight;
      bucket.saturation += (chroma / (1 - Math.abs(2 * lightness - 1))) * weight;
   }
   if (!visible || colorful / visible < 0.04) return null;
   const dominant = buckets.reduce((best, bucket) => (bucket.weight > best.weight ? bucket : best));
   if (!dominant.weight) return null;
   const hue = Math.round(((Math.atan2(dominant.y, dominant.x) * 180) / Math.PI + 360) % 360);
   const saturation = Math.round(Math.max(0.45, Math.min(0.72, dominant.saturation / dominant.weight)) * 100);
   return `hsl(${hue} ${saturation}% 74%)`;
}
