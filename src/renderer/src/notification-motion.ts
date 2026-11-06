import { flushSync } from "react-dom";
import type { NotificationTone } from "./notifications";

/**
 * Notification movement between the toast stack and the status-bar pills.
 *
 * The store changes right away, so the real toast and pills always match the
 * state. The motion runs on a ghost, a fixed box that resizes from one shape
 * to the other with a copy of each inside. Resizing (not scaling) keeps text
 * at its real size, and the copies crossfade through a light blur so the
 * shape reads as one surface flowing into the other. The ghost is aria-hidden
 * and inert, so nothing can find or click it.
 */

/** Fast start, long soft stop, no overshoot. */
export const FLUID = "cubic-bezier(0.22, 1, 0.36, 1)";
const FLIGHT_MS = 420;
const LEAVE_MS = 160;

/** Each pill lists every id it stands for, space separated. */
export const chipSelector = (id: number) => `[data-notification-chip~="${id}"]`;
const toastSelector = (id: number) => `[data-toast-id="${id}"]`;
const pillSelector = (tone: NotificationTone) => `.notification-pill[data-tone="${tone}"]`;

export const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Where each pill ends up after the latest render, measured before its own
 * glide starts. Flights aim here rather than at a pill that is still moving.
 */
export const pillTargets = new Map<NotificationTone, DOMRect>();

interface Look {
   rect: DOMRect;
   radius: string;
   background: string;
   border: string;
   shadow: string;
}

function look(element: HTMLElement, rect = element.getBoundingClientRect(), radius?: string): Look {
   const style = getComputedStyle(element);
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
   copy.classList.remove("toast", "receiving", "awaiting", "holding");
   copy.removeAttribute("data-notification-chip");
   copy.removeAttribute("data-toast-id");
   copy.removeAttribute("data-tone");
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

const pillLook = (pill: HTMLElement, rect = pill.getBoundingClientRect()) => look(pill, rect, `${rect.height / 2}px`);

/** Resize the ghost between two looks while one copy dissolves into the other. */
function fly(from: Look, to: Look, leaving: HTMLElement, arriving: HTMLElement): Promise<void> {
   const element = ghost(leaving, arriving);
   const timing = { duration: FLIGHT_MS, easing: FLUID, fill: "both" as const };
   leaving.animate(
      [
         { opacity: 1, filter: "blur(0)" },
         { opacity: 0, filter: "blur(3px)", offset: 0.45 },
         { opacity: 0, filter: "blur(3px)" },
      ],
      { ...timing, easing: "linear" }
   );
   arriving.animate(
      [
         { opacity: 0, filter: "blur(3px)" },
         { opacity: 0, filter: "blur(3px)", offset: 0.25 },
         { opacity: 1, filter: "blur(0)", offset: 0.75 },
         { opacity: 1, filter: "blur(0)" },
      ],
      { ...timing, easing: "linear" }
   );
   const done = () => element.remove();
   return element.animate([box(from), box(to)], timing).finished.then(done, done);
}

/**
 * Move a toast into its pill. `commit` makes the store change (toast to chip,
 * or pinned to closed). It runs synchronously so the pill is in place to aim at.
 */
export function flyToChip(toast: HTMLElement | null, id: number, tone: NotificationTone, commit: () => void): void {
   if (!toast || still()) return commit();
   const from = look(toast);
   const leaving = layer(toast, from.rect);
   const existed = !!document.querySelector(pillSelector(tone));
   flushSync(commit);
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill) return;
   const to = pillLook(pill, pillTargets.get(tone) ?? pill.getBoundingClientRect());
   const arriving = layer(pill, to.rect);
   // An existing pill stays as an empty shell that eases to its new size; a new one waits hidden.
   const waiting = existed ? "receiving" : "awaiting";
   pill.classList.add(waiting);
   void fly(from, to, leaving, arriving).then(() => pill.classList.remove(waiting));
}

/** A pinned toast just mounted: grow it out of its pill. */
export function flyFromChip(toast: HTMLElement, id: number): void {
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill || still()) return;
   const from = pillLook(pill);
   const to = look(toast);
   // Opacity, not visibility, so its buttons work while the copy is still growing.
   toast.style.opacity = "0";
   void fly(from, to, layer(pill, from.rect), layer(toast, to.rect)).then(() => {
      toast.style.opacity = "";
   });
}

/** Close the pinned toast back into its pill. */
export function closePinned(id: number, tone: NotificationTone, commit: () => void): void {
   flyToChip(document.querySelector<HTMLElement>(toastSelector(id)), id, tone, commit);
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

/**
 * Glide children to their new layout places. Positions come from offsetTop and
 * offsetLeft, which ignore transforms, so an entrance animation in progress
 * can't be mistaken for a move.
 */
export function glide(container: HTMLElement, last: Map<string, { x: number; y: number }>, key: (element: HTMLElement) => string | undefined): void {
   const next = new Map<string, { x: number; y: number }>();
   for (const child of Array.from(container.children) as HTMLElement[]) {
      const id = key(child);
      if (!id) continue;
      const place = { x: child.offsetLeft, y: child.offsetTop };
      next.set(id, place);
      const before = last.get(id);
      if (!before || still()) continue;
      const dx = before.x - place.x;
      const dy = before.y - place.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 380, easing: FLUID, composite: "add" });
   }
   last.clear();
   for (const [id, place] of next) last.set(id, place);
}
