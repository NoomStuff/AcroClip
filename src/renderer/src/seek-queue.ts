const nextFrame = (callback: () => void): number =>
   typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : (setTimeout(callback, 16) as unknown as number);
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

/**
 * Lets each seek finish decoding before the next, like AttaCut's seeker. Writing currentTime on
 * every pointer move restarts Chromium's decode each time, so a fast drag shows no new frame until
 * it stops. Here only the latest request waits, and it goes out once the previous seek has shown.
 */
export class SeekQueue {
   private requested: number | null = null;
   private target: number | null = null;
   private video: HTMLVideoElement | null = null;
   private scheduled = 0;
   private deadline: ReturnType<typeof setTimeout> | undefined;

   attach(video: HTMLVideoElement): () => void {
      this.video = video;
      const complete = () => {
         this.cancelScheduled();
         const advance = () => {
            this.cancelScheduled();
            this.flush();
         };
         this.scheduled = nextFrame(advance);
         // A hidden window may stop delivering frames. A finished seek must not wait on painting.
         this.deadline = setTimeout(advance, 50);
      };
      const ready = () => this.flush();
      video.addEventListener("seeked", complete);
      video.addEventListener("loadeddata", ready);
      return () => {
         video.removeEventListener("seeked", complete);
         video.removeEventListener("loadeddata", ready);
         this.cancelScheduled();
         this.requested = null;
         this.target = null;
         if (this.video === video) this.video = null;
      };
   }
   seek(time: number): void {
      this.requested = time;
      this.target = time;
      this.flush();
   }
   /** Where the player is heading while a seek is still on its way, so the playhead doesn't jump back. */
   pendingTime(): number | null {
      return this.requested !== null || this.scheduled !== 0 || this.video?.seeking ? this.target : null;
   }
   private cancelScheduled() {
      if (this.scheduled) cancelFrame(this.scheduled);
      clearTimeout(this.deadline);
      this.scheduled = 0;
   }
   private flush() {
      const video = this.video;
      if (!video?.readyState || video.seeking || this.scheduled || this.requested === null) return;
      const time = this.requested;
      this.requested = null;
      if (Math.abs(video.currentTime - time) > 0.00001) video.currentTime = time;
   }
}
