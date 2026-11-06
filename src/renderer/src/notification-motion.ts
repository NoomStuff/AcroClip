import { flushSync } from "react-dom";

/**
 * Notification movement between the toast stack and the status-bar pill.
 *
 * The store changes right away, so the real toast and pill always match the
 * state. The motion runs on a ghost, a fixed box that resizes from one shape
 * to the other with a copy of each inside. Resizing (not scaling) keeps text
 * at its real size, so the toast looks like it is drawn into the pill instead of
 * squashed. The ghost is aria-hidden and inert, so nothing can find or click it.
 */

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const FLIGHT_MS = 520;
const LEAVE_MS = 160;

/** The pill lists every id it stands for, space separated. */
export const chipSelector = (id: number) => `[data-notification-chip~="${id}"]`;
const toastSelector = (id: number) => `[data-toast-id="${id}"]`;

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Look {
   rect: DOMRect;
   radius: string;
   background: string;
   border: string;
   shadow: string;
}

function look(element: HTMLElement, radius?: string): Look {
   const style = getComputedStyle(element);
   const rect = element.getBoundingClientRect();
   return {
      rect,
      radius: radius ?? style.borderTopLeftRadius,
      background: style.backgroundColor,
      border: style.borderTopColor,
      shadow: style.boxShadow === "none" ? "0 0 0 0 transparent" : style.boxShadow,
   };
}

const box = (value: Look): Keyframe => ({
   left: `${value.rect.left}px`,
   top: `${value.rect.top}px`,
   width: `${value.rect.width}px`,
   height: `${value.rect.height}px`,
   borderRadius: value.radius,
   backgroundColor: value.background,
   borderColor: value.border,
   boxShadow: value.shadow,
});

/** A copy of `element` pinned to the ghost's top left at its real size. */
function layer(element: HTMLElement, rect: DOMRect): HTMLElement {
   const copy = element.cloneNode(true) as HTMLElement;
   // Keep the copy out of class and attribute lookups meant for the real thing.
   copy.classList.remove("toast");
   copy.removeAttribute("data-notification-chip");
   copy.removeAttribute("data-toast-id");
   copy.removeAttribute("role");
   copy.classList.add("notification-layer");
   copy.style.width = `${rect.width}px`;
   copy.style.height = `${rect.height}px`;
   return copy;
}

function ghost(...layers: HTMLElement[]): HTMLDivElement {
   const element = document.createElement("div");
   element.className = "notification-ghost";
   element.setAttribute("aria-hidden", "true");
   element.inert = true;
   element.append(...layers);
   document.body.append(element);
   return element;
}

const pillLook = (pill: HTMLElement) => look(pill, `${pill.getBoundingClientRect().height / 2}px`);

/** Resize the ghost between two looks while one copy fades out and the other fades in. */
function fly(from: Look, to: Look, leaving: HTMLElement, arriving: HTMLElement): Promise<void> {
   const element = ghost(leaving, arriving);
   const timing = { duration: FLIGHT_MS, easing: EASE, fill: "both" as const };
   // The box shrinks fastest early on, so the toast text stays until it is mostly clipped away.
   leaving.animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }], timing);
   arriving.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.7 }, { opacity: 1 }], timing);
   const done = () => element.remove();
   return element.animate([box(from), box(to)], timing).finished.then(done, done);
}

function land(pill: HTMLElement) {
   pill.animate([{ transform: "scale(1.08)" }, { transform: "scale(0.98)", offset: 0.55 }, { transform: "none" }], { duration: 300, easing: "ease-out" });
}

/**
 * Move a toast into its pill. `commit` makes the store change (toast to chip,
 * or pinned to closed). It runs synchronously so the pill is in place to aim at.
 */
export function flyToChip(toast: HTMLElement | null, id: number, commit: () => void): void {
   if (!toast || still()) return commit();
   const from = look(toast);
   const leaving = layer(toast, from.rect);
   const before = document.querySelector(".notification-pill")?.getBoundingClientRect().width;
   flushSync(commit);
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill) return;
   // Aim at the pill's final size; the flight drives the widening itself.
   for (const animation of pill.getAnimations()) animation.cancel();
   const to = pillLook(pill);
   const existed = before !== undefined;
   if (existed && Math.abs(before - to.rect.width) > 1)
      pill.animate([{ width: `${before}px` }, { width: `${to.rect.width}px` }], { duration: FLIGHT_MS * 0.8, easing: EASE });
   const arriving = layer(pill, to.rect);
   // An existing pill stays as an empty shell that widens to make room; a new one waits hidden.
   pill.classList.add(existed ? "receiving" : "awaiting");
   void fly(from, to, leaving, arriving).then(() => {
      pill.classList.remove("receiving", "awaiting");
      land(pill);
   });
}

/** A pinned toast just mounted: grow it out of its pill. */
export function flyFromChip(toast: HTMLElement, id: number): void {
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill || still()) return;
   const from = pillLook(pill);
   const to = look(toast);
   toast.style.visibility = "hidden";
   void fly(from, to, layer(pill, from.rect), layer(toast, to.rect)).then(() => {
      toast.style.visibility = "";
   });
}

/** Close the pinned toast back into its pill. */
export function closePinned(id: number, commit: () => void): void {
   flyToChip(document.querySelector<HTMLElement>(toastSelector(id)), id, commit);
}

/** Slide a toast out to the right, for dismissals and plain notices that time out. */
export function leave(toast: HTMLElement | null, commit: () => void): void {
   if (!toast || still()) return commit();
   const rect = toast.getBoundingClientRect();
   const copy = layer(toast, rect);
   flushSync(commit);
   const element = ghost(copy);
   // Below the stack, so toasts gliding into the gap pass over it.
   element.classList.add("leaving");
   Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
   const done = () => element.remove();
   element
      .animate(
         [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateX(24px) scale(0.96)" },
         ],
         { duration: LEAVE_MS, easing: "ease-in", fill: "both" }
      )
      .finished.then(done, done);
}

/** Glide the stack's toasts to their new places after one arrives or leaves. */
export function glide(container: HTMLElement, last: Map<string, number>): void {
   const next = new Map<string, number>();
   for (const child of Array.from(container.children) as HTMLElement[]) {
      const key = child.dataset["toastId"];
      if (!key) continue;
      const top = child.getBoundingClientRect().top;
      next.set(key, top);
      const before = last.get(key);
      if (before === undefined || Math.abs(before - top) < 1 || still()) continue;
      child.animate([{ transform: `translateY(${before - top}px)` }, { transform: "none" }], {
         duration: 380,
         delay: 40,
         easing: EASE,
         fill: "backwards",
         composite: "add",
      });
   }
   last.clear();
   for (const [key, top] of next) last.set(key, top);
}
