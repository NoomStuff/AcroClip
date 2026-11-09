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
