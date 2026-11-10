import { useEffect, useLayoutEffect, useReducer, useRef } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Time constant for following a pointer: close enough to feel direct, smooth enough to hide jitter. */
export const pointerSmoothingMs = 20;

interface SmoothOptions {
   /** How long easing across a jump takes. */
   duration?: number;
   /** Time constant in ms for continuous input. Retargeting never restarts the frame loop. */
   follow?: number;
   /** Changes smaller than this snap without animating, so frame stepping stays 1:1. */
   jump?: number;
   /** True snaps this update, such as while playback drives the value. */
   snap?: () => boolean;
   /** A new key snaps to the target instead of easing, such as a new drag. */
   key?: string | number;
}

/**
 * Tweens discrete changes with a cubic ease-out, or follows continuous input with frame-rate
 * independent damping. The same motion as AttaCut's playhead. The loop schedules itself and
 * consumes its frame slot on entry, so a stale id never blocks a restart.
 */
export function useSmoothValue(target: number, options: SmoothOptions = {}): number {
   const [, render] = useReducer((count: number) => count + 1, 0);
   const optionsRef = useRef(options);
   const display = useRef(target);
   const targetRef = useRef(target);
   const keyRef = useRef<string | number | undefined>(options.key);
   const run = useRef<{ from: number; start: number; last: number } | null>(null);
   const frame = useRef(0);

   useLayoutEffect(() => {
      optionsRef.current = options;
      const previous = display.current;
      if (target !== targetRef.current) {
         targetRef.current = target;
         const { jump = 0, snap, follow } = options;
         if (reducedMotion() || Math.abs(target - display.current) < jump || (snap?.() ?? false)) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
            run.current = null;
            display.current = target;
         } else if (!follow || !run.current) {
            const now = performance.now();
            run.current = { from: display.current, start: now, last: now };
         }
      }
      if (options.key !== keyRef.current) {
         keyRef.current = options.key;
         cancelAnimationFrame(frame.current);
         frame.current = 0;
         run.current = null;
         display.current = targetRef.current;
      }
      if (display.current !== previous) render();
   });

   useEffect(() => {
      if (!run.current || frame.current) return;
      const tick = (now: number) => {
         frame.current = 0;
         const current = run.current;
         if (!current) return;
         const { duration = 170, follow } = optionsRef.current;
         let finished: boolean;
         if (follow) {
            const elapsed = Math.max(0, now - current.last);
            current.last = Math.max(current.last, now);
            display.current += (targetRef.current - display.current) * (1 - Math.exp(-elapsed / follow));
            finished = Math.abs(targetRef.current - display.current) < 0.00001;
         } else {
            // A queued frame can come before the event that retargeted this tween.
            const progress = Math.min(1, Math.max(0, (now - current.start) / duration));
            display.current = current.from + (targetRef.current - current.from) * (1 - (1 - progress) ** 3);
            finished = progress === 1;
         }
         if (finished) {
            display.current = targetRef.current;
            run.current = null;
         } else frame.current = requestAnimationFrame(tick);
         render();
      };
      frame.current = requestAnimationFrame(tick);
   });
   useEffect(
      () => () => {
         cancelAnimationFrame(frame.current);
         frame.current = 0;
      },
      []
   );
   // The displayed value lives in a ref so frames don't wait on React state. Each change renders.
   return display.current;
}
