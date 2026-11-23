import type { Locator } from "@playwright/test";

/**
 * Hovers a submenu trigger once its menu has finished opening. A menu scales in, so a trigger hovered
 * mid-animation slides out from under Playwright's still pointer when it lands, and the submenu then
 * closes as if the pointer had left. A person's pointer keeps moving, so this only affects tests.
 */
export async function hoverSubmenu(trigger: Locator): Promise<void> {
   await trigger.evaluate((node) =>
      Promise.all((node.closest(".floating-menu")?.getAnimations({ subtree: true }) ?? []).map((animation) => animation.finished.catch(() => undefined)))
   );
   await trigger.hover();
}
