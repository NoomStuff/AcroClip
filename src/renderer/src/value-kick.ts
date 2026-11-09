import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { FrameScheduler } from "./slider-motion";

export interface ValueKickOptions {
   /** How far one kick moves the value, in units where 1 is a full step bump. */
   strength: number;
   /** The furthest stacked kicks can push it, in the same units. */
   limit: number;
   /** Vertical travel at one unit, in pixels. */
   lift: number;
   /** Extra scale at one unit. */
   grow: number;
}

/** For a slider's value readout. Lighter than a stepper's bump, since a drag changes the value every frame. */
export const readoutKick: ValueKickOptions = { strength: 0.45, limit: 1.17, lift: 2, grow: 0.08 };

// An underdamped spring: a kick overshoots once, slightly, on its way back.
const stiffness = 500;
const damping = 26;
// The impulse that peaks this spring at about one unit.
const unitImpulse = 44;

/**
 * A number nudged in the direction it changed, then sprung back. Kicks add to each
 * other, so quick repeated changes build up, but never past the limit.
 */
export function createValueKick(paint: (offset: number) => void, scheduler: FrameScheduler, options: ValueKickOptions) {
   let position = 0,
      velocity = 0,
      frame = 0,
      lastTime: number | null = null,
      disposed = false;
   const step = (time: number) => {
      frame = 0;
      if (disposed) return;
      const elapsed = lastTime === null ? 1 / 120 : Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      const steps = Math.max(1, Math.ceil(elapsed * 240)),
         dt = elapsed / steps;
      for (let index = 0; index < steps; index++) {
         velocity += (-position * stiffness - velocity * damping) * dt;
         position += velocity * dt;
         if (Math.abs(position) > options.limit) {
            position = Math.sign(position) * options.limit;
            velocity = 0;
         }
      }
      if (Math.abs(position) < 0.002 && Math.abs(velocity) < 0.02) {
         position = 0;
         velocity = 0;
      }
      paint(position);
      if (position !== 0 || velocity !== 0) frame = scheduler.request(step);
      else lastTime = null;
   };
   return {
      /** `size` scales the kick, so one large jump moves as far as the many small ones it replaces. */
      kick(direction: 1 | -1, size = 1) {
         if (disposed) return;
         velocity += direction * Math.min(options.strength * size, options.limit) * unitImpulse;
         if (!frame) {
            lastTime = null;
            frame = scheduler.request(step);
         }
      },
      dispose() {
         disposed = true;
         scheduler.cancel(frame);
         frame = 0;
      },
   };
}

export function kickTransform(offset: number, options: Pick<ValueKickOptions, "lift" | "grow">): string {
   if (offset === 0) return "";
   return `translateY(${(-offset * options.lift).toFixed(2)}px) scale(${(1 + Math.abs(offset) * options.grow).toFixed(4)})`;
}

const browserFrames: FrameScheduler = { request: (callback) => requestAnimationFrame(callback), cancel: (frame) => cancelAnimationFrame(frame) };

/** Binds a value kick to an element, doing nothing while reduced motion is on. */
export function bindValueKick(element: HTMLElement, options: ValueKickOptions) {
   const motion = createValueKick(
      (offset) => {
         element.style.transform = kickTransform(offset, options);
      },
      browserFrames,
      options
   );
   return {
      kick(direction: 1 | -1, size = 1) {
         if (!matchMedia("(prefers-reduced-motion: reduce)").matches) motion.kick(direction, size);
      },
      dispose() {
         motion.dispose();
         element.style.transform = "";
      },
   };
}

/** A quick pop that confirms a choice landed, on the element's own scale so it composes with its transform. */
export function selectionBounce(element: Element | null | undefined, amount = 0.04) {
   if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
   element.animate([{ scale: "1" }, { scale: String(1 + amount), offset: 0.35 }, { scale: String(1 - amount / 4), offset: 0.7 }, { scale: "1" }], {
      duration: 360,
      easing: "cubic-bezier(0.22, 0.8, 0.3, 1)",
   });
}

// The share of a slider's range one drag event typically covers. A jump of this much is one kick.
const dragShare = 0.04;

/**
 * Kicks the element whenever the value changes, up for an increase and down for a decrease.
 * Changes the reader is already watching happen, such as typing, pass `quiet`. With `range`,
 * a click that jumps along a slider kicks as hard as dragging there would, up to the limit.
 */
export function useValueKick(
   value: number,
   element: RefObject<HTMLElement | null>,
   options: ValueKickOptions,
   quiet: () => boolean = () => false,
   range?: number
) {
   const previous = useRef(value);
   const motion = useRef<ReturnType<typeof bindValueKick> | null>(null);
   const latestQuiet = useRef(quiet);
   useLayoutEffect(() => {
      latestQuiet.current = quiet;
   });
   const { strength, limit, lift, grow } = options;
   useEffect(() => {
      const node = element.current;
      if (!node) return;
      const bound = bindValueKick(node, { strength, limit, lift, grow });
      motion.current = bound;
      return () => {
         bound.dispose();
         motion.current = null;
      };
   }, [element, strength, limit, lift, grow]);
   useLayoutEffect(() => {
      const from = previous.current;
      previous.current = value;
      if (from === value || !Number.isFinite(from) || !Number.isFinite(value) || latestQuiet.current()) return;
      const size = range && range > 0 ? Math.max(1, Math.abs(value - from) / (range * dragShare)) : 1;
      motion.current?.kick(value > from ? 1 : -1, size);
   }, [value, range]);
}
