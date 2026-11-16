import { describe, expect, it } from "vitest";
import { POLL_TICK_MS, pollDue, pollJobs, type PollJob, type PollState } from "./poll-plan";

const flags = ["background", "fastStatus", "capturing", "searching", "following", "pendingAudio"] as const;
/** Every combination of states, including ones the app can't reach, so no rule is missed. */
const everyState: PollState[] = Array.from({ length: 2 ** flags.length }, (_, bits) => {
   const state = {} as Record<(typeof flags)[number], boolean>;
   flags.forEach((flag, index) => (state[flag] = (bits & (1 << index)) !== 0));
   return state;
});
const ticksPerMinute = 60_000 / POLL_TICK_MS;
/** Ticks in one simulated minute on which `job` runs. */
const ticksOf = (job: PollJob, state: PollState) => {
   const ticks: number[] = [];
   for (let tick = 0; tick < ticksPerMinute; tick++) if (pollDue(tick, state).includes(job)) ticks.push(tick);
   return ticks;
};
const perSecond = (job: PollJob, state: PollState) => ticksOf(job, state).length / 60;
const base: PollState = { background: false, fastStatus: false, capturing: true, searching: false, following: false, pendingAudio: false };
const listingJobs: PollJob[] = ["followGame", "pendingAudio", "desktopGame"];

describe("poll plan", () => {
   it("never puts a status report and an app listing on the same tick", () => {
      for (const state of everyState) {
         const status = new Set(ticksOf("status", state));
         for (const job of listingJobs) for (const tick of ticksOf(job, state)) expect(status.has(tick), `${job} ${JSON.stringify(state)}`).toBe(false);
      }
   });
   it("lets every job that needs a listing share one, so at most one listing per second", () => {
      for (const state of everyState) {
         const listingTicks = new Set(listingJobs.flatMap((job) => ticksOf(job, state)));
         expect(listingTicks.size).toBeLessThanOrEqual(60);
         // Spread out: two listings are always at least a second apart.
         const sorted = [...listingTicks].sort((a, b) => a - b);
         for (let index = 1; index < sorted.length; index++) expect(sorted[index]! - sorted[index - 1]!).toBeGreaterThanOrEqual(1000 / POLL_TICK_MS);
      }
   });
   it("does no app listings while nothing is captured", () => {
      for (const state of everyState.filter((item) => !item.capturing)) for (const job of listingJobs) expect(ticksOf(job, state)).toEqual([]);
   });
   it("reports status once a second, every two seconds in the background, and three times a second while a source starts", () => {
      expect(perSecond("status", base)).toBe(1);
      expect(perSecond("status", { ...base, background: true })).toBe(0.5);
      expect(perSecond("status", { ...base, fastStatus: true, background: true })).toBe(3);
   });
   it("looks for a game every second in every state, and checks a followed game every two seconds in the background", () => {
      expect(perSecond("followGame", { ...base, following: true, searching: true, background: true })).toBe(1);
      expect(perSecond("followGame", { ...base, following: true })).toBe(1);
      expect(perSecond("followGame", { ...base, following: true, background: true })).toBe(0.5);
      expect(perSecond("followGame", { ...base, following: false, searching: true })).toBe(0);
   });
   it("attaches a waiting app's audio within a second in every state", () => {
      expect(perSecond("pendingAudio", { ...base, pendingAudio: true, background: true })).toBe(1);
      expect(perSecond("pendingAudio", base)).toBe(0);
   });
   it("samples the game in a desktop capture every five seconds, inside the 12 s gap the watch tolerates", () => {
      for (const state of everyState.filter((item) => item.capturing)) {
         const ticks = ticksOf("desktopGame", state);
         expect(ticks.length).toBe(12);
         for (let index = 1; index < ticks.length; index++) expect((ticks[index]! - ticks[index - 1]!) * POLL_TICK_MS).toBe(5000);
      }
   });
   it("names every job it schedules", () => {
      for (const state of everyState) for (let tick = 0; tick < 40; tick++) for (const job of pollDue(tick, state)) expect(pollJobs).toContain(job);
   });
});
