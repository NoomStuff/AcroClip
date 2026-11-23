import { flushSync } from "react-dom";
import type { NotificationTone } from "./notifications";

/**
 * Notification movement between the toast stack and the status-bar pills.
 *
 * The store changes right away, so the real toast and pills always match the
 * state. The motion runs on a ghost, a fixed box that resizes from one shape
 * to the other with a copy of each inside. Resizing (not scaling) keeps text
 * at its real size while the two copies crossfade. The copy keeps its tone
 * attribute so its colors match the real pill exactly. The ghost is aria-hidden
 * and inert, so nothing can find or click it.
 *
 * Each notification has at most one flight. Opening and closing a message
 * quickly reverses its flight from wherever the ghost is, so two ghosts never
 * stack and nothing jumps back to a start it already left.
 */

/** Quick, with a small overshoot before it settles. Growing out of a pill uses it. */
const SPRING = "cubic-bezier(0.34, 1.36, 0.64, 1)";
/** No overshoot. A box that shrinks past its pill and bounces back reads as a glitch. */
const SETTLE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const FLIGHT_MS = 340;
const LEAVE_MS = 160;

/** Each pill lists every id it stands for, space separated. */
const chipSelector = (id: number) => `[data-notification-chip~="${id}"]`;
const toastSelector = (id: number) => `[data-toast-id="${id}"]`;
const pillSelector = (tone: NotificationTone) => `.notification-area > .notification-pill[data-tone="${tone}"]`;

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
   copy.removeAttribute("role");
   // An open pill shows a collapse arrow. Its copy shows the message it stands for.
   for (const node of Array.from(copy.querySelectorAll(".holding"))) node.classList.remove("holding");
   for (const node of Array.from(copy.querySelectorAll("[aria-expanded]"))) node.removeAttribute("aria-expanded");
   copy.classList.add("notification-layer");
   // A toast hidden behind its own flight is copied visible.
   copy.style.opacity = "";
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

interface Flight {
   ghost: HTMLDivElement;
   pill: HTMLElement;
   toast: HTMLElement;
   /** Lets go of the real pill or toast this flight hides. */
   release: () => void;
}
/** The flight each notification is on, by id. */
const flights = new Map<number, Flight>();

/** Where an interrupted flight had got to: the ghost's look and how visible each copy was. */
interface Midway {
   look: Look;
   pill: number;
   toast: number;
}

/** Stops a notification's flight where it is, so the next motion can start from there. */
function interrupt(id: number): Midway | null {
   const flight = flights.get(id);
   if (!flight) return null;
   flights.delete(id);
   const midway = {
      look: look(flight.ghost),
      pill: Number(getComputedStyle(flight.pill).opacity),
      toast: Number(getComputedStyle(flight.toast).opacity),
   };
   for (const animation of [...flight.ghost.getAnimations(), ...flight.pill.getAnimations(), ...flight.toast.getAnimations()]) animation.cancel();
   flight.ghost.remove();
   flight.release();
   return midway;
}

/**
 * Resize the ghost between two looks while one copy fades into the other. A
 * flight that takes over from an interrupted one continues from its opacities.
 */
function fly(
   id: number,
   route: { from: Look; to: Look; towards: "pill" | "toast" },
   copies: { pill: HTMLElement; toast: HTMLElement },
   midway: Midway | null,
   release: () => void
): void {
   const element = ghost(copies.pill, copies.toast);
   const pillward = route.towards === "pill";
   const [leaving, arriving] = pillward ? [copies.toast, copies.pill] : [copies.pill, copies.toast];
   const fade = { duration: FLIGHT_MS, easing: "linear", fill: "both" as const };
   if (midway) {
      const [out, into] = pillward ? [midway.toast, midway.pill] : [midway.pill, midway.toast];
      leaving.animate([{ opacity: out }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], fade);
      arriving.animate([{ opacity: into }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], fade);
   } else {
      leaving.animate([{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], fade);
      arriving.animate([{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], fade);
   }
   const flight: Flight = { ghost: element, ...copies, release };
   flights.set(id, flight);
   const done = () => {
      // A later flight took over and owns the cleanup now.
      if (flights.get(id) !== flight) return;
      flights.delete(id);
      element.remove();
      release();
   };
   element.animate([box(route.from), box(route.to)], { duration: FLIGHT_MS, easing: pillward ? SETTLE : SPRING, fill: "both" }).finished.then(done, done);
}

/**
 * Move a toast into its pill. `commit` makes the store change (toast to chip,
 * or pinned to closed). It runs synchronously so the pill is in place to aim at.
 */
export function flyToChip(toast: HTMLElement | null, id: number, tone: NotificationTone, commit: () => void): void {
   const midway = interrupt(id);
   if (!toast || still()) return commit();
   const from = midway?.look ?? look(toast);
   const leaving = layer(toast, toast.getBoundingClientRect());
   const existed = !!document.querySelector(pillSelector(tone));
   flushSync(commit);
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill) return;
   const to = pillLook(pill, pillTargets.get(tone) ?? pill.getBoundingClientRect());
   const arriving = layer(pill, to.rect);
   // An existing pill stays as an empty shell that eases to its new size; a new one waits hidden.
   const waiting = existed ? "receiving" : "awaiting";
   pill.classList.add(waiting);
   // The flight is this pill's entrance, so drop the pop-in the render just started.
   if (!existed) for (const animation of pill.getAnimations()) animation.cancel();
   fly(id, { from, to, towards: "pill" }, { pill: arriving, toast: leaving }, midway, () => pill.classList.remove(waiting));
}

/** A pinned toast just mounted: grow it out of its pill. */
export function flyFromChip(toast: HTMLElement, id: number): void {
   const midway = interrupt(id);
   const pill = document.querySelector<HTMLElement>(chipSelector(id));
   if (!pill || still()) return;
   const from = midway?.look ?? pillLook(pill);
   const to = look(toast);
   // Opacity, not visibility, so its buttons work while the copy is still growing.
   toast.style.opacity = "0";
   fly(id, { from, to, towards: "toast" }, { pill: layer(pill, pill.getBoundingClientRect()), toast: layer(toast, to.rect) }, midway, () => {
      toast.style.opacity = "";
   });
}

/** Close the pinned toast back into its pill. */
export function closePinned(id: number, tone: NotificationTone, commit: () => void): void {
   flyToChip(document.querySelector<HTMLElement>(toastSelector(id)), id, tone, commit);
}

/** Slide a toast out to the right, for dismissals and plain notices that time out. */
export function leave(toast: HTMLElement | null, commit: () => void): void {
   const id = Number(toast?.dataset["toastId"]);
   // A toast dismissed mid-flight leaves from where its flight had got to.
   const midway = Number.isFinite(id) ? interrupt(id) : null;
   if (!toast || still()) return commit();
   const rect = midway?.look.rect ?? toast.getBoundingClientRect();
   const copy = layer(toast, toast.getBoundingClientRect());
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

/** Clear all: the pills shrink away right to left, then the store empties. */
export function sweepOut(commit: () => void): void {
   const pills = Array.from(document.querySelectorAll<HTMLElement>(".notification-area > .notification-pill")).reverse();
   if (!pills.length || still()) return commit();
   const animations = pills.map((pill, index) =>
      pill.animate(
         [
            { transform: "none", opacity: 1 },
            { transform: "scale(0.6)", opacity: 0 },
         ],
         {
            duration: 180,
            delay: index * 40,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
            fill: "forwards",
         }
      )
   );
   void Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(commit);
}

/** A pill that appears without a flight pops in. */
export function popIn(element: HTMLElement): void {
   if (still()) return;
   element.animate(
      [
         { transform: "scale(0.6)", opacity: 0 },
         { transform: "none", opacity: 1 },
      ],
      { duration: 300, easing: SPRING }
   );
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
      child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 360, easing: SPRING, composite: "add" });
   }
   last.clear();
   for (const [id, place] of next) last.set(id, place);
}
