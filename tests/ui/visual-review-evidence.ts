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
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const elements = new Set<HTMLElement>();
      while (walker.nextNode()) {
         const node = walker.currentNode;
         if (node.textContent?.trim() && node.parentElement instanceof HTMLElement) elements.add(node.parentElement);
      }
      for (const element of document.querySelectorAll<HTMLElement>(
         "input:not([type=range]),.icon-button,.record-action,.clip-action,.source-row,.player-progress-track,.mixer-fader-track,.slider-track"
      ))
         elements.add(element);
      const focused = document.activeElement;
      return [...elements].flatMap((element) => {
         if (!element.checkVisibility() || element.closest(":disabled, [aria-disabled='true'],script,style,option")) return [];
         const track = element.matches(".player-progress-track,.mixer-fader-track,.slider-track");
         const input = element instanceof HTMLInputElement ? element : undefined;
         const text = input ? input.value || input.placeholder : element.textContent?.trim();
         const kind = track ? "track" : text ? "text" : "icon";
         const bounds = element.getBoundingClientRect();
         if (!bounds.width || !bounds.height) return [];
         const ancestors: HTMLElement[] = [];
         for (let node: HTMLElement | null = element; node; node = node.parentElement) ancestors.unshift(node);
         // Images, blending and whole-element opacity cannot be established by color tokens alone.
         if (ancestors.some((node) => Number(getComputedStyle(node).opacity) < 1 || getComputedStyle(node).backgroundImage !== "none")) return [];
         let background: Color = [0, 0, 0, 1];
         for (const node of track ? ancestors.slice(0, -1) : ancestors) background = over(color(getComputedStyle(node).backgroundColor), background);
         const style = getComputedStyle(element);
         const ink = track ? style.backgroundColor : input && !input.value && input.placeholder ? getComputedStyle(input, "::placeholder").color : style.color;
         const foreground = over(color(ink), background);
         const light = luminance(foreground),
            dark = luminance(background);
         return [
            {
               kind,
               requiredContrast: kind === "text" ? 4.5 : 3,
               text: text?.slice(0, 80) || element.getAttribute("aria-label") || element.className,
               focus: element === focused ? { width: style.outlineWidth, color: style.outlineColor, style: style.outlineStyle } : undefined,
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
