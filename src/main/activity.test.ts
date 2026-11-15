import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityTracker, BACKGROUND_AFTER_MS } from "./activity";

afterEach(() => {
   vi.useRealTimers();
});

describe("background activity", () => {
   it("slows down 10 s after losing focus and speeds up as soon as focus returns", () => {
      vi.useFakeTimers();
      const changes: boolean[] = [];
      const tracker = new ActivityTracker((background) => changes.push(background));
      tracker.update({ visible: true, focused: false, fullscreen: false });
      vi.advanceTimersByTime(BACKGROUND_AFTER_MS - 1);
      expect(tracker.background).toBe(false);
      // Repeated updates while unfocused don't restart the wait.
      tracker.update({ visible: true, focused: false, fullscreen: false });
      vi.advanceTimersByTime(1);
      expect(tracker.background).toBe(true);
      tracker.update({ visible: true, focused: true, fullscreen: true });
      expect(changes).toEqual([true, false]);
   });
   it("goes to the background at once behind a fullscreen app or with the window hidden", () => {
      vi.useFakeTimers();
      const changes: boolean[] = [];
      const tracker = new ActivityTracker((background) => changes.push(background));
      tracker.update({ visible: true, focused: false, fullscreen: true });
      expect(tracker.background).toBe(true);
      tracker.update({ visible: true, focused: true, fullscreen: false });
      tracker.update({ visible: false, focused: false, fullscreen: false });
      expect(changes).toEqual([true, false, true]);
   });
   it("forgets a pending slowdown when focus returns first", () => {
      vi.useFakeTimers();
      const changes: boolean[] = [];
      const tracker = new ActivityTracker((background) => changes.push(background));
      tracker.update({ visible: true, focused: false, fullscreen: false });
      vi.advanceTimersByTime(5000);
      tracker.update({ visible: true, focused: true, fullscreen: false });
      vi.advanceTimersByTime(BACKGROUND_AFTER_MS);
      expect(changes).toEqual([]);
   });
});
