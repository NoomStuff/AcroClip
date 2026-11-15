/** How long AcroClip stays unfocused before its own upkeep slows down. */
export const BACKGROUND_AFTER_MS = 10_000;

export interface WindowActivity {
   visible: boolean;
   focused: boolean;
   /** Another app is fullscreen in front, which usually means a game is running. */
   fullscreen: boolean;
}

/**
 * Decides when AcroClip is in the background. Focused, it may poll freely. Once it has been unfocused
 * for `BACKGROUND_AFTER_MS`, or at once when its window is hidden or a fullscreen app is in front,
 * it keeps its own updates to the minimum so the game keeps the machine.
 */
export class ActivityTracker {
   private readonly onChange: (background: boolean) => void;
   private readonly delay: number;
   private timer: ReturnType<typeof setTimeout> | null = null;
   private current = false;
   constructor(onChange: (background: boolean) => void, delay = BACKGROUND_AFTER_MS) {
      this.onChange = onChange;
      this.delay = delay;
   }
   get background(): boolean {
      return this.current;
   }
   update(activity: WindowActivity): void {
      if (activity.visible && activity.focused) {
         this.cancel();
         this.set(false);
      } else if (!activity.visible || activity.fullscreen) {
         this.cancel();
         this.set(true);
      } else if (!this.current && !this.timer) {
         this.timer = setTimeout(() => {
            this.timer = null;
            this.set(true);
         }, this.delay);
         this.timer.unref?.();
      }
   }
   close(): void {
      this.cancel();
   }
   private cancel(): void {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
   }
   private set(background: boolean): void {
      if (background === this.current) return;
      this.current = background;
      this.onChange(background);
   }
}
