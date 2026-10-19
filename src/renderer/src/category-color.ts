import type { CSSProperties } from "react";
// Keep stored colors intact. Lift only dark display colors until text and its
// matching icon clear 4.5:1 against the tinted dark category row.
export function categoryColors(color: string): { ink: string; tint: string } {
   const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : "#b197fc";
   const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
   const luminance = (values: number[]) =>
      values.reduce((sum, value, index) => {
         const channel = value / 255;
         return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
      }, 0);
   for (let step = 0; step <= 100; step++) {
      const display = rgb.map((value) => Math.round(value + ((255 - value) * step) / 100));
      const background = display.map((value, index) => value * 0.094 + [21, 21, 24][index]! * 0.906);
      if ((luminance(display) + 0.05) / (luminance(background) + 0.05) >= 4.5) {
         const ink = `#${display.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
         return { ink, tint: `${ink}18` };
      }
   }
   return { ink: "#ffffff", tint: "#ffffff18" };
}
export function categoryStyle(color: string): CSSProperties {
   const { ink, tint } = categoryColors(color);
   return { "--category-color": ink, "--category-tint": tint } as CSSProperties;
}
