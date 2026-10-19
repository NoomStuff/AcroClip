// Adapted from Better Osiris useGridHoverGuide: one retained frame loop,
// exponential chase using elapsed time, and a 0.01 percent settling threshold.
export interface FrameScheduler {
   request: (callback: FrameRequestCallback) => number;
   cancel: (frame: number) => void;
}
export function createSliderMotion(initial: number, paint: (position: number) => void, scheduler: FrameScheduler) {
   let position = initial,
      target = initial,
      frame = 0,
      lastTime: number | null = null,
      disposed = false;
   const finish = () => {
      scheduler.cancel(frame);
      frame = 0;
      lastTime = null;
      position = target;
      paint(position);
   };
   const step = (time: number) => {
      frame = 0;
      if (disposed) return;
      const delta = lastTime === null ? 0 : Math.min(Math.max((time - lastTime) / 1000, 0), 0.1);
      lastTime = time;
      position += (target - position) * (1 - Math.exp(-18 * delta));
      if (Math.abs(target - position) < 0.01) position = target;
      paint(position);
      if (position !== target) frame = scheduler.request(step);
      else lastTime = null;
   };
   return {
      to(next: number, immediate = false) {
         if (disposed) return;
         target = Math.max(0, Math.min(100, next));
         if (immediate) finish();
         else if (!frame && position !== target) {
            lastTime = null;
            frame = scheduler.request(step);
         }
      },
      finish,
      dispose() {
         disposed = true;
         scheduler.cancel(frame);
         frame = 0;
      },
   };
}

// A retained spring follows changing hover targets without restarting an easing curve.
export function createHoverMotion(initial: number, paint: (value: number) => void, scheduler: FrameScheduler) {
   let position = initial,
      target = initial,
      velocity = 0,
      frame = 0,
      lastTime: number | null = null,
      disposed = false;
   const finish = () => {
      scheduler.cancel(frame);
      frame = 0;
      lastTime = null;
      position = target;
      velocity = 0;
      paint(position);
   };
   const step = (time: number) => {
      frame = 0;
      if (disposed) return;
      const elapsed = lastTime === null ? 0 : Math.min(0.04, Math.max(0, (time - lastTime) / 1000));
      lastTime = time;
      const steps = Math.max(1, Math.ceil(elapsed * 120)),
         dt = elapsed / steps;
      for (let i = 0; i < steps; i++) {
         velocity += ((target - position) * 360 - velocity * 24) * dt;
         position += velocity * dt;
         if (position < 0) {
            position = 0;
            velocity = Math.max(0, velocity);
         }
         if (position > 1.08) {
            position = 1.08;
            velocity = Math.min(0, velocity);
         }
      }
      if (Math.abs(target - position) < 0.001 && Math.abs(velocity) < 0.01) {
         position = target;
         velocity = 0;
      }
      paint(position);
      if (position !== target || velocity !== 0) frame = scheduler.request(step);
      else lastTime = null;
   };
   return {
      to(next: number, immediate = false) {
         if (disposed) return;
         target = Math.max(0, Math.min(1, next));
         if (immediate) finish();
         else if (!frame && (position !== target || velocity !== 0)) {
            lastTime = null;
            frame = scheduler.request(step);
         }
      },
      finish,
      dispose() {
         disposed = true;
         scheduler.cancel(frame);
         frame = 0;
      },
   };
}
