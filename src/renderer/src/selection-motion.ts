import type { FrameScheduler } from "./slider-motion";
export interface SelectionPoint {
   x: number;
   y: number;
}
export function createSelectionMotion(paint: (point: SelectionPoint) => void, scheduler: FrameScheduler) {
   let current = { x: 0, y: 0 },
      target = current,
      velocity = { x: 0, y: 0 },
      low = current,
      high = current;
   let frame = 0,
      lastTime: number | null = null,
      disposed = false;
   const stop = () => {
      scheduler.cancel(frame);
      frame = 0;
      lastTime = null;
   };
   const step = (time: number) => {
      frame = 0;
      if (disposed) return;
      const elapsed = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      const steps = Math.max(1, Math.ceil(elapsed * 120)),
         dt = elapsed / steps;
      for (let step = 0; step < steps; step++)
         for (const axis of ["x", "y"] as const) {
            velocity[axis] += ((target[axis] - current[axis]) * 420 - velocity[axis] * 30) * dt;
            const next = current[axis] + velocity[axis] * dt;
            current[axis] = Math.max(low[axis], Math.min(high[axis], next));
            if (current[axis] !== next) velocity[axis] = 0;
         }
      if (Math.hypot(target.x - current.x, target.y - current.y) < 0.03 && Math.hypot(velocity.x, velocity.y) < 0.1) {
         current = { ...target };
         velocity = { x: 0, y: 0 };
      }
      paint(current);
      if (current.x !== target.x || current.y !== target.y) frame = scheduler.request(step);
      else lastTime = null;
   };
   return {
      to(next: SelectionPoint, bounds: SelectionPoint, immediate: boolean) {
         if (disposed) return;
         target = { ...next };
         if (immediate) {
            stop();
            current = { ...target };
            velocity = { x: 0, y: 0 };
            paint(current);
            return;
         }
         for (const axis of ["x", "y"] as const) {
            const cap = Math.min(5, Math.abs(target[axis] - current[axis]) * 0.06);
            low = { ...low, [axis]: Math.max(0, Math.min(current[axis], target[axis]) - cap) };
            high = { ...high, [axis]: Math.min(bounds[axis], Math.max(current[axis], target[axis]) + cap) };
         }
         const clamped = { x: Math.max(0, Math.min(bounds.x, current.x)), y: Math.max(0, Math.min(bounds.y, current.y)) };
         if (clamped.x !== current.x || clamped.y !== current.y) {
            current = clamped;
            paint(current);
         }
         if (!frame && (current.x !== target.x || current.y !== target.y)) {
            lastTime = null;
            frame = scheduler.request(step);
         }
      },
      dispose() {
         disposed = true;
         stop();
      },
   };
}
