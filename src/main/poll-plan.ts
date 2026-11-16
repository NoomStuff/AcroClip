/**
 * When AcroClip's recurring capture checks run. One 250 ms clock drives them all, so their timing
 * is decided here instead of by separate timers that drift into each other.
 *
 * Measured on a desktop PC (bun scripts/benchmark-polling.ts): a status report from the running
 * recorder takes 0.09 ms and listing open apps through it 0.5 ms. Only listing apps by starting a
 * new recorder process is expensive, about 28 ms and 24 ms of CPU, and the app only does that
 * while the recorder is busy or not running. So rates favor feeling instant, and the plan's other
 * job is keeping work apart: status reports and app listings never share a tick, and every job
 * that needs a listing shares one tick, so one listing serves them all.
 */
export const POLL_TICK_MS = 250;

export interface PollState {
   /** AcroClip has been out of focus for a while, is hidden, or a fullscreen app is in front. */
   background: boolean;
   /** A source just started or changed, so the canvas fit should follow quickly. */
   fastStatus: boolean;
   /** Capture is running or waiting for its source. */
   capturing: boolean;
   /** Auto capture is looking for a game it doesn't have yet. */
   searching: boolean;
   /** Auto capture follows the game in front. */
   following: boolean;
   /** An app's audio track waits for that app to open. */
   pendingAudio: boolean;
}

export type PollJob = "status" | "followGame" | "pendingAudio" | "desktopGame";

/** Ticks between runs, or null when the job has nothing to do. */
export function pollEvery(job: PollJob, state: PollState): number | null {
   switch (job) {
      case "status":
         // Reports carry state, buffer length and warnings. Meters arrive on their own.
         return state.fastStatus ? 1 : state.background ? 8 : 4;
      case "followGame":
         if (!state.capturing || !state.following) return null;
         // A game that just opened is footage being lost, so searching stays at 1 s even while a
         // game is in front. A game that's already followed only needs its closing noticed.
         return state.searching || !state.background ? 4 : 8;
      case "pendingAudio":
         // An app that just opened is audio being lost, in any state.
         return state.capturing && state.pendingAudio ? 4 : null;
      case "desktopGame":
         // Samples which game fills a desktop clip. A steady 5 s keeps the samples comparable.
         return state.capturing ? 20 : null;
   }
}

/** Status reports run on these ticks of each second, app listings on tick 2. */
const LISTING_TICK = 2;
const usesListing: Record<PollJob, boolean> = { status: false, followGame: true, pendingAudio: true, desktopGame: true };
export const pollJobs: readonly PollJob[] = ["status", "followGame", "pendingAudio", "desktopGame"];

/** The jobs due on one tick of the shared clock. */
export function pollDue(tick: number, state: PollState): PollJob[] {
   return pollJobs.filter((job) => {
      const every = pollEvery(job, state);
      if (every === null) return false;
      if (usesListing[job]) return tick % every === LISTING_TICK % every;
      // Fast status reports skip the listing tick, so the two still never meet.
      if (every === 1) return tick % 4 !== LISTING_TICK;
      return tick % every === 0;
   });
}
