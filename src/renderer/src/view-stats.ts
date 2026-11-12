import { watchedBuckets } from "../../shared/stats";
import type { ViewEvent } from "../../shared/stats-log";

/** One stretch of watching a clip, from opening it until leaving it. */
export interface WatchSession {
   clipId: string;
   duration: number;
   seconds: number;
   watched: number[];
   // Playback position at the previous tick, or null right after a seek.
   last: number | null;
   bucket: number;
   completed: boolean;
}

export function startWatch(clipId: string, duration: number): WatchSession {
   return { clipId, duration, seconds: 0, watched: Array<number>(watchedBuckets).fill(0), last: null, bucket: -1, completed: false };
}

const bucketAt = (session: WatchSession, time: number) => Math.min(watchedBuckets - 1, Math.max(0, Math.floor((time / session.duration) * watchedBuckets)));

/**
 * Counts playback since the previous tick. Only steady forward progress counts as watching,
 * so time skipped by a seek is not credited. Each pass through a slice of the clip adds one
 * to it, which is what makes a rewatched moment stand out.
 */
export function watchTick(session: WatchSession, time: number): void {
   if (!(session.duration > 0) || !Number.isFinite(time)) return;
   const bucket = bucketAt(session, time);
   const delta = session.last === null ? Number.NaN : time - session.last;
   const mark = (index: number) => (session.watched[index] = Math.min(255, session.watched[index]! + 1));
   if (delta > 0 && delta < 2) {
      session.seconds += delta;
      // At high speed one tick can cross several slices; each one was played.
      for (let index = session.bucket + 1; index <= bucket; index++) mark(index);
      if (time >= session.duration * 0.95) session.completed = true;
      session.bucket = Math.max(session.bucket, bucket);
   } else if (delta !== 0) {
      // Opening, seeking and looping all start a new pass here.
      mark(bucket);
      session.bucket = bucket;
   }
   session.last = time;
}

/** A seek or a switch to another file: the next tick starts a new pass. */
export function watchSeek(session: WatchSession): void {
   session.last = null;
   session.bucket = -1;
}

/** The event to record, or null when nothing was really watched. */
export function watchEvent(session: WatchSession): ViewEvent | null {
   if (session.seconds < 1) return null;
   return {
      type: "view",
      clipId: session.clipId,
      seconds: Math.round(session.seconds * 10) / 10,
      duration: Math.round(session.duration * 10) / 10,
      watched: [...session.watched],
      completed: session.completed,
   };
}
