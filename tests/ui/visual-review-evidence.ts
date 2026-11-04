import type { Page } from "@playwright/test";

// Measure rendered UI text, including translucent surfaces. Media captions and
// disabled controls need separate treatment and are deliberately not sampled.
export async function textEvidence(page: Page) {
   return page.evaluate(() => {
      type Color = [number, number, number, number];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const color = (value: string): Color => {
         context.clearRect(0, 0, 1, 1);
         context.fillStyle = value;
         context.fillRect(0, 0, 1, 1);
         const pixel = context.getImageData(0, 0, 1, 1).data;
         return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
      };
      const over = (front: Color, back: Color): Color => [
         front[0] * front[3] + back[0] * (1 - front[3]),
         front[1] * front[3] + back[1] * (1 - front[3]),
         front[2] * front[3] + back[2] * (1 - front[3]),
         1,
      ];
      const luminance = (value: Color) =>
         value.slice(0, 3).reduce((total, channel, index) => {
            const normalized = channel / 255;
            return total + (normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!;
         }, 0);
      const selectors =
         "h1,h2,.field-label,.field-detail,.sidebar-section-control,.sidebar-item,.clip-card-info p,.viewer-title time,.viewer-category,.viewer-share-hint,.button,.context-header-label";
      return [...document.querySelectorAll<HTMLElement>(selectors)].flatMap((element) => {
         if (!element.checkVisibility() || !element.textContent?.trim() || element.closest(":disabled")) return [];
         const ancestors: HTMLElement[] = [];
         for (let node: HTMLElement | null = element; node; node = node.parentElement) ancestors.unshift(node);
         // Images, blending and whole-element opacity cannot be established by color tokens alone.
         if (ancestors.some((node) => Number(getComputedStyle(node).opacity) < 1 || getComputedStyle(node).backgroundImage !== "none")) return [];
         let background: Color = [0, 0, 0, 1];
         for (const node of ancestors) background = over(color(getComputedStyle(node).backgroundColor), background);
         const style = getComputedStyle(element);
         const foreground = over(color(style.color), background);
         const light = luminance(foreground),
            dark = luminance(background);
         return [
            {
               text: element.textContent.trim().slice(0, 80),
               className: element.className,
               background,
               font: style.fontFamily,
               size: style.fontSize,
               weight: style.fontWeight,
               color: style.color,
               contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
            },
         ];
      });
   });
}
