/**
 * Focus rings, keyboard menu highlights and focus tooltips are for people moving through the app by
 * keyboard. A shortcut, typing in a field, or a key that never moves focus doesn't count, so using
 * the player's Space or arrows after a click doesn't put a ring on the button clicked.
 */

/** Key presses the app took as one of its shortcuts. */
const shortcuts = new WeakSet<Event>();
export function markShortcut(event: KeyboardEvent): void {
   shortcuts.add(event);
}

/** Keys that move focus or act on the focused control. Tab always does. */
const navigation = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Enter", " "]);
const textEntry = 'textarea, [contenteditable="true"], input:not([type="range"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"])';

/** Whether this key press is someone navigating by keyboard. Pure, given whether the app used it as a shortcut. */
export function navigatesByKeyboard(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">, target: Element | null, shortcut: boolean): boolean {
   if (event.key === "Tab") return true;
   if (shortcut || event.ctrlKey || event.metaKey || event.altKey || !navigation.has(event.key)) return false;
   // Arrows, Home and End inside a text field move the caret, and Space types.
   return !target?.closest(textEntry);
}

export function installKeyboardMode(root: HTMLElement = document.documentElement): void {
   document.addEventListener(
      "keydown",
      (event) => {
         const target = event.target instanceof Element ? event.target : null;
         // The shortcut handler runs after this capture listener, so the decision waits for it.
         setTimeout(() => {
            if (navigatesByKeyboard(event, target, shortcuts.has(event))) root.dataset["keyboard"] = "true";
         });
      },
      true
   );
   document.addEventListener(
      "pointerdown",
      () => {
         delete root.dataset["keyboard"];
      },
      true
   );
}
