import { describe, expect, it, vi } from "vitest";
import { SeekQueue } from "./seek-queue";

// The parts of a video element a seek touches: setting currentTime starts a seek that "seeked" ends.
class FakeVideo extends EventTarget {
   readyState = 4;
   seeking = false;
   writes: number[] = [];
   private time = 0;
   get currentTime() {
      return this.time;
   }
   set currentTime(value: number) {
      this.time = value;
      this.writes.push(value);
      this.seeking = true;
   }
   finishSeek() {
      this.seeking = false;
      this.dispatchEvent(new Event("seeked"));
   }
}

describe("seek queue", () => {
   it("sends only the latest of rapid requests once the current seek has shown", () => {
      vi.useFakeTimers();
      const video = new FakeVideo();
      const queue = new SeekQueue();
      queue.attach(video as unknown as HTMLVideoElement);
      queue.seek(1);
      for (const time of [2, 3, 4, 5]) queue.seek(time);
      expect(video.writes).toEqual([1]);
      expect(queue.pendingTime()).toBe(5);
      video.finishSeek();
      vi.advanceTimersByTime(60);
      expect(video.writes).toEqual([1, 5]);
      video.finishSeek();
      vi.advanceTimersByTime(60);
      expect(queue.pendingTime()).toBeNull();
      vi.useRealTimers();
   });
   it("waits for the video to load before seeking", () => {
      const video = new FakeVideo();
      video.readyState = 0;
      const queue = new SeekQueue();
      queue.attach(video as unknown as HTMLVideoElement);
      queue.seek(3);
      expect(video.writes).toEqual([]);
      video.readyState = 4;
      video.dispatchEvent(new Event("loadeddata"));
      expect(video.writes).toEqual([3]);
   });
   it("forgets requests for a video it no longer follows", () => {
      const video = new FakeVideo();
      video.readyState = 0;
      const queue = new SeekQueue();
      const detach = queue.attach(video as unknown as HTMLVideoElement);
      queue.seek(3);
      detach();
      expect(queue.pendingTime()).toBeNull();
   });
});
