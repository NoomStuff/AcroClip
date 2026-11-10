import { saveTriggers, statsActions, watchedBuckets } from "./stats";
import type { SaveTrigger, StatsAction, StatsEvent } from "./stats";
import type { Clip } from "./types";

/**
 * Turns the usage history and the library into the numbers a stats page shows. Pure, so the
 * page can ask for any range and tests can pin every figure. The history answers what happened
 * (capture time, rewatches, saves); the library answers what is there now, including clips
 * older than the history or saved by other tools.
 */

export interface DayStats {
   /** Local calendar day, YYYY-MM-DD. */
   date: string;
   captureSeconds: number;
   appSeconds: number;
   /** New clips plus extensions of earlier ones: each is a moment the user asked to keep. */
   moments: number;
   savedSeconds: number;
   views: number;
   watchSeconds: number;
   shareables: number;
   copies: number;
}

export interface ApplicationStats {
   /** The application ID, or `source:<label>` for captures without one, such as a screen. */
   key: string;
   name: string;
   moments: number;
   savedSeconds: number;
   captureSeconds: number;
   views: number;
   watchSeconds: number;
}

export interface ClipStats {
   clipId: string;
   name: string | null;
   /** Still in the collection. */
   exists: boolean;
   views: number;
   watchSeconds: number;
   completions: number;
   copies: number;
   /** Where in the clip playback passed most often, in seconds, when some part was rewatched. */
   replayPeak: number | null;
}

export interface StatsSummary {
   generatedAt: number;
   range: { from: number | null; to: number };
   /** The first recorded event, or null without any history. */
   since: number | null;
   app: {
      launches: number;
      /** Runs that ended without closing cleanly. */
      uncleanExits: number;
      updates: Array<{ at: number; from: string; to: string }>;
      windowOpens: number;
      windowSeconds: number;
      settingsChanges: number;
      topSettings: Array<{ key: string; changes: number }>;
      setupCompletedAt: number | null;
   };
   capture: {
      sessions: number;
      seconds: number;
      longestSessionSeconds: number;
      endedByError: number;
      bySourceKind: { screen: number; app: number };
   };
   saves: {
      moments: number;
      newClips: number;
      extensions: number;
      savedSeconds: number;
      averageClipSeconds: number | null;
      /** From the save request to a usable file. */
      latency: { median: number; p95: number; fastest: number } | null;
      triggers: Record<SaveTrigger, number>;
      /** Moments per hour of capture. */
      perCaptureHour: number | null;
      /** Clip length setting versus what saves turned out as. */
      bufferUse: number | null;
   };
   watching: {
      views: number;
      seconds: number;
      completions: number;
      /** Clips viewed at least once, of every clip seen in the history. */
      clipsViewed: number;
      topClips: ClipStats[];
   };
   sharing: {
      shareables: number;
      automatic: number;
      bytesSaved: number;
      encodeSeconds: number;
      copies: { clipboard: number; drag: number; clip: number; shareable: number };
   };
   cleanup: {
      deletedClips: number;
      deletedShareables: number;
      deletedUnwatched: number;
      /** How long deleted clips were kept, on average. */
      averageAgeDays: number | null;
   };
   actions: Record<StatsAction, number>;
   days: DayStats[];
   activeDays: number;
   averages: { momentsPerActiveDay: number | null; captureSecondsPerActiveDay: number | null };
   streaks: { current: number; longest: number };
   /** Local hour of day, 0 to 23. */
   hours: { moments: number[]; captureSeconds: number[] };
   /** Sunday first, like Date.getDay(). */
   weekdays: { moments: number[]; captureSeconds: number[] };
   applications: ApplicationStats[];
   library: {
      clips: number;
      bytes: number;
      seconds: number;
      unwatched: number;
      tagged: number;
      withShareables: number;
      merged: number;
      oldest: number | null;
      newest: number | null;
      longestClipId: string | null;
      largestClipId: string | null;
      applications: Array<{ key: string; name: string; clips: number; seconds: number }>;
      /** Clips created per month, YYYY-MM. */
      months: Array<{ month: string; clips: number }>;
   };
}

export interface SummaryOptions {
   now?: number;
   /** Only events at or after this time count. The library is always whole. */
   from?: number;
   topClips?: number;
}

const pad = (value: number) => String(value).padStart(2, "0");
export const dayKey = (at: number) => {
   const date = new Date(at);
   return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const nextMidnight = (at: number) => {
   const date = new Date(at);
   return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};
const nextHour = (at: number) => {
   const date = new Date(at);
   return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours() + 1).getTime();
};

/** Splits [start, end) at local hour boundaries, so time across midnight lands on both days. */
function forEachHour(start: number, end: number, visit: (at: number, seconds: number) => void) {
   let cursor = start;
   while (cursor < end) {
      const boundary = Math.min(end, nextHour(cursor), nextMidnight(cursor));
      visit(cursor, (boundary - cursor) / 1000);
      cursor = boundary;
   }
}

function percentile(sorted: number[], fraction: number) {
   return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))]!;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const zeros = (length: number) => Array<number>(length).fill(0);
const countBy = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

export function summarizeStats(events: StatsEvent[], clips: Clip[], options: SummaryOptions = {}): StatsSummary {
   const now = options.now ?? Date.now();
   const from = options.from;
   const inRange = events.filter((event) => (from === undefined || event.at >= from) && event.at <= now).sort((a, b) => a.at - b.at);
   const clipById = new Map(clips.map((clip) => [clip.id, clip]));
   const days = new Map<string, DayStats>();
   const day = (at: number) => {
      const key = dayKey(at);
      let entry = days.get(key);
      if (!entry) {
         entry = { date: key, captureSeconds: 0, appSeconds: 0, moments: 0, savedSeconds: 0, views: 0, watchSeconds: 0, shareables: 0, copies: 0 };
         days.set(key, entry);
      }
      return entry;
   };
   const applications = new Map<string, ApplicationStats>();
   const application = (id: string | undefined, source: string | undefined) => {
      const key = id || `source:${source || "Unknown"}`;
      let entry = applications.get(key);
      if (!entry) {
         entry = { key, name: source || id || "Unknown", moments: 0, savedSeconds: 0, captureSeconds: 0, views: 0, watchSeconds: 0 };
         applications.set(key, entry);
      }
      // The newest label wins, so a renamed game shows its current name.
      if (source) entry.name = source;
      return entry;
   };
   // Which application each clip came from, for crediting views. Extensions credit the clip they grew.
   const clipApplication = new Map<string, ApplicationStats>();
   const clipStats = new Map<string, ClipStats & { heat: number[] }>();
   const clipEntry = (clipId: string) => {
      let entry = clipStats.get(clipId);
      if (!entry) {
         const clip = clipById.get(clipId);
         entry = {
            clipId,
            name: clip?.name ?? null,
            exists: !!clip,
            views: 0,
            watchSeconds: 0,
            completions: 0,
            copies: 0,
            replayPeak: null,
            heat: zeros(watchedBuckets),
         };
         clipStats.set(clipId, entry);
      }
      return entry;
   };

   const summary: StatsSummary = {
      generatedAt: now,
      range: { from: from ?? null, to: now },
      since: inRange[0]?.at ?? null,
      app: { launches: 0, uncleanExits: 0, updates: [], windowOpens: 0, windowSeconds: 0, settingsChanges: 0, topSettings: [], setupCompletedAt: null },
      capture: { sessions: 0, seconds: 0, longestSessionSeconds: 0, endedByError: 0, bySourceKind: { screen: 0, app: 0 } },
      saves: {
         moments: 0,
         newClips: 0,
         extensions: 0,
         savedSeconds: 0,
         averageClipSeconds: null,
         latency: null,
         triggers: countBy(saveTriggers),
         perCaptureHour: null,
         bufferUse: null,
      },
      watching: { views: 0, seconds: 0, completions: 0, clipsViewed: 0, topClips: [] },
      sharing: { shareables: 0, automatic: 0, bytesSaved: 0, encodeSeconds: 0, copies: { clipboard: 0, drag: 0, clip: 0, shareable: 0 } },
      cleanup: { deletedClips: 0, deletedShareables: 0, deletedUnwatched: 0, averageAgeDays: null },
      actions: countBy(statsActions),
      days: [],
      activeDays: 0,
      averages: { momentsPerActiveDay: null, captureSecondsPerActiveDay: null },
      streaks: { current: 0, longest: 0 },
      hours: { moments: zeros(24), captureSeconds: zeros(24) },
      weekdays: { moments: zeros(7), captureSeconds: zeros(7) },
      applications: [],
      library: librarySummary(clips),
   };
   const latencies: number[] = [];
   const settings = new Map<string, number>();
   const deletedAges: number[] = [];
   let bufferSeconds = 0;
   let bufferedSaves = 0;
   for (const event of inRange) {
      switch (event.type) {
         case "launch":
            summary.app.launches++;
            if (event.unclean) summary.app.uncleanExits++;
            if (event.previousVersion && event.previousVersion !== event.version)
               summary.app.updates.push({ at: event.at, from: event.previousVersion, to: event.version });
            break;
         case "window":
            summary.app.windowOpens++;
            summary.app.windowSeconds += event.seconds;
            forEachHour(event.at - event.seconds * 1000, event.at, (at, seconds) => (day(at).appSeconds += seconds));
            break;
         case "settings":
            summary.app.settingsChanges++;
            for (const key of event.keys) settings.set(key, (settings.get(key) ?? 0) + 1);
            if (event.keys.includes("setupComplete") && summary.app.setupCompletedAt === null) summary.app.setupCompletedAt = event.at;
            break;
         case "capture": {
            summary.capture.sessions++;
            summary.capture.seconds += event.seconds;
            summary.capture.longestSessionSeconds = Math.max(summary.capture.longestSessionSeconds, event.seconds);
            if (event.ended === "error") summary.capture.endedByError++;
            if (event.sourceKind) summary.capture.bySourceKind[event.sourceKind] += event.seconds;
            const owner = event.application || event.source ? application(event.application, event.source) : undefined;
            if (owner) owner.captureSeconds += event.seconds;
            forEachHour(event.startedAt, event.startedAt + event.seconds * 1000, (at, seconds) => {
               day(at).captureSeconds += seconds;
               const date = new Date(at);
               summary.hours.captureSeconds[date.getHours()]! += seconds;
               summary.weekdays.captureSeconds[date.getDay()]! += seconds;
            });
            break;
         }
         case "save": {
            summary.saves.moments++;
            if (event.outcome === "extended") summary.saves.extensions++;
            else summary.saves.newClips++;
            summary.saves.savedSeconds += event.seconds;
            if (event.latencyMs !== undefined) latencies.push(event.latencyMs);
            if (event.trigger) summary.saves.triggers[event.trigger]++;
            if (event.bufferSeconds) {
               bufferSeconds += Math.min(1, event.seconds / event.bufferSeconds);
               bufferedSaves++;
            }
            const owner = application(event.application, event.source);
            owner.moments++;
            owner.savedSeconds += event.seconds;
            clipApplication.set(event.clipId, owner);
            if (event.into) clipApplication.set(event.into, owner);
            const entry = day(event.at);
            entry.moments++;
            entry.savedSeconds += event.seconds;
            const date = new Date(event.at);
            summary.hours.moments[date.getHours()]!++;
            summary.weekdays.moments[date.getDay()]!++;
            break;
         }
         case "view": {
            summary.watching.views++;
            summary.watching.seconds += event.seconds;
            if (event.completed) summary.watching.completions++;
            const entry = clipEntry(event.clipId);
            entry.views++;
            entry.watchSeconds += event.seconds;
            if (event.completed) entry.completions++;
            event.watched.forEach((count, index) => (entry.heat[index]! += count));
            const owner = clipApplication.get(event.clipId) ?? libraryApplication(clipById.get(event.clipId), application);
            if (owner) {
               owner.views++;
               owner.watchSeconds += event.seconds;
            }
            const today = day(event.at);
            today.views++;
            today.watchSeconds += event.seconds;
            break;
         }
         case "shareable":
            summary.sharing.shareables++;
            if (event.automatic) summary.sharing.automatic++;
            summary.sharing.bytesSaved += Math.max(0, event.sourceBytes - event.bytes);
            summary.sharing.encodeSeconds += event.encodeSeconds;
            day(event.at).shareables++;
            break;
         case "copy":
            summary.sharing.copies[event.method]++;
            summary.sharing.copies[event.file]++;
            clipEntry(event.clipId).copies++;
            day(event.at).copies++;
            break;
         case "delete":
            if (event.scope === "clip") {
               summary.cleanup.deletedClips++;
               if (!event.watched) summary.cleanup.deletedUnwatched++;
               if (event.clipCreatedAt) deletedAges.push((event.at - event.clipCreatedAt) / 86_400_000);
            } else summary.cleanup.deletedShareables++;
            break;
         case "action":
            summary.actions[event.action]++;
            break;
      }
   }

   summary.app.topSettings = [...settings]
      .map(([key, changes]) => ({ key, changes }))
      .sort((a, b) => b.changes - a.changes || a.key.localeCompare(b.key))
      .slice(0, 10);
   if (summary.saves.moments) summary.saves.averageClipSeconds = round(summary.saves.savedSeconds / summary.saves.moments);
   if (latencies.length) {
      const sorted = latencies.sort((a, b) => a - b);
      summary.saves.latency = { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), fastest: sorted[0]! };
   }
   if (summary.capture.seconds >= 60) summary.saves.perCaptureHour = round(summary.saves.moments / (summary.capture.seconds / 3600), 2);
   if (bufferedSaves) summary.saves.bufferUse = round(bufferSeconds / bufferedSaves, 3);
   if (deletedAges.length) summary.cleanup.averageAgeDays = round(deletedAges.reduce((sum, age) => sum + age, 0) / deletedAges.length);

   const clipsSeen = [...clipStats.values()];
   summary.watching.clipsViewed = clipsSeen.filter((entry) => entry.views > 0).length;
   summary.watching.topClips = clipsSeen
      .filter((entry) => entry.views > 0)
      .sort((a, b) => b.views - a.views || b.watchSeconds - a.watchSeconds || a.clipId.localeCompare(b.clipId))
      .slice(0, options.topClips ?? 10)
      .map(({ heat, ...entry }) => {
         const peak = Math.max(...heat);
         const index = heat.indexOf(peak);
         const duration = clipById.get(entry.clipId)?.duration;
         return {
            ...entry,
            watchSeconds: round(entry.watchSeconds),
            replayPeak: peak > 1 && duration ? round(((index + 0.5) / watchedBuckets) * duration) : null,
         };
      });

   summary.days = [...days.values()]
      .map((entry) => ({
         ...entry,
         captureSeconds: round(entry.captureSeconds),
         appSeconds: round(entry.appSeconds),
         savedSeconds: round(entry.savedSeconds),
         watchSeconds: round(entry.watchSeconds),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
   const active = summary.days.filter((entry) => entry.moments > 0 || entry.captureSeconds > 0);
   summary.activeDays = active.length;
   if (active.length) {
      summary.averages.momentsPerActiveDay = round(summary.saves.moments / active.length, 2);
      summary.averages.captureSecondsPerActiveDay = round(summary.capture.seconds / active.length);
   }
   summary.streaks = streaks(
      summary.days.filter((entry) => entry.moments > 0).map((entry) => entry.date),
      now
   );
   summary.hours.captureSeconds = summary.hours.captureSeconds.map((value) => round(value));
   summary.weekdays.captureSeconds = summary.weekdays.captureSeconds.map((value) => round(value));
   summary.capture.seconds = round(summary.capture.seconds);
   summary.app.windowSeconds = round(summary.app.windowSeconds);
   summary.saves.savedSeconds = round(summary.saves.savedSeconds);
   summary.watching.seconds = round(summary.watching.seconds);
   summary.sharing.encodeSeconds = round(summary.sharing.encodeSeconds);
   summary.applications = [...applications.values()]
      .map((entry) => ({
         ...entry,
         savedSeconds: round(entry.savedSeconds),
         captureSeconds: round(entry.captureSeconds),
         watchSeconds: round(entry.watchSeconds),
      }))
      .sort((a, b) => b.moments - a.moments || b.captureSeconds - a.captureSeconds || a.name.localeCompare(b.name));
   return summary;
}

function libraryApplication(clip: Clip | undefined, application: (id: string | undefined, source: string | undefined) => ApplicationStats) {
   return clip ? application(clip.applicationId, clip.source) : undefined;
}

/** Consecutive local days with at least one save. Today without a save yet keeps yesterday's run alive. */
function streaks(dates: string[], now: number): StatsSummary["streaks"] {
   const days = new Set(dates);
   let longest = 0;
   for (const date of dates) {
      const [year, month, dayOfMonth] = date.split("-").map(Number) as [number, number, number];
      if (days.has(dayKey(new Date(year, month - 1, dayOfMonth - 1).getTime()))) continue;
      let length = 1;
      while (days.has(dayKey(new Date(year, month - 1, dayOfMonth + length).getTime()))) length++;
      longest = Math.max(longest, length);
   }
   const today = new Date(now);
   let offset = days.has(dayKey(now)) ? 0 : 1;
   let current = 0;
   while (days.has(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset).getTime()))) {
      current++;
      offset++;
   }
   return { current, longest };
}

function librarySummary(clips: Clip[]): StatsSummary["library"] {
   const applications = new Map<string, { key: string; name: string; clips: number; seconds: number }>();
   const months = new Map<string, number>();
   let longest: Clip | undefined;
   let largest: Clip | undefined;
   let bytes = 0;
   let seconds = 0;
   for (const clip of clips) {
      bytes += clip.size;
      seconds += clip.duration;
      if (!longest || clip.duration > longest.duration) longest = clip;
      if (!largest || clip.size > largest.size) largest = clip;
      const key = clip.applicationId || `source:${clip.source || "Unknown"}`;
      const entry = applications.get(key) ?? { key, name: clip.source || clip.applicationId || "Unknown", clips: 0, seconds: 0 };
      entry.clips++;
      entry.seconds += clip.duration;
      applications.set(key, entry);
      const created = new Date(clip.createdAt);
      const month = `${created.getFullYear()}-${pad(created.getMonth() + 1)}`;
      months.set(month, (months.get(month) ?? 0) + 1);
   }
   // Reduce, not spread: a large library would overflow the argument list.
   const created = clips.map((clip) => clip.createdAt);
   const oldest = created.reduce<number | null>((value, at) => (value === null || at < value ? at : value), null);
   const newest = created.reduce<number | null>((value, at) => (value === null || at > value ? at : value), null);
   return {
      clips: clips.length,
      bytes,
      seconds: round(seconds),
      unwatched: clips.filter((clip) => !clip.watched).length,
      tagged: clips.filter((clip) => clip.categories.length > 0).length,
      withShareables: clips.filter((clip) => clip.shareables.length > 0).length,
      merged: clips.filter((clip) => (clip.mergedFrom ?? 0) > 1).length,
      oldest,
      newest,
      longestClipId: longest?.id ?? null,
      largestClipId: largest?.id ?? null,
      applications: [...applications.values()]
         .map((entry) => ({ ...entry, seconds: round(entry.seconds) }))
         .sort((a, b) => b.clips - a.clips || a.name.localeCompare(b.name)),
      months: [...months].map(([month, count]) => ({ month, clips: count })).sort((a, b) => a.month.localeCompare(b.month)),
   };
}
