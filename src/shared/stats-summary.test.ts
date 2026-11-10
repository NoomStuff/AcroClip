import { describe, expect, it } from "vitest";
import { summarizeStats } from "./stats-summary";
import { statsVersion, watchedBuckets } from "./stats";
import type { StatsEvent, StatsEventInput } from "./stats";
import type { Clip } from "./types";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const event = (time: number, input: StatsEventInput): StatsEvent => ({ ...input, v: statsVersion, at: time });
const clip = (id: string, extra: Partial<Clip> = {}, withoutApplication = false): Clip => ({
   id,
   path: `/clips/${id}.mp4`,
   relativePath: `${id}.mp4`,
   name: `Clip ${id}`,
   source: "Deep Rock",
   applicationId: "deep-rock",
   size: 50_000_000,
   duration: 30,
   width: 1920,
   height: 1080,
   createdAt: at(1, 12),
   thumbnail: "",
   playbackUrl: "",
   tracks: [],
   categories: [],
   shareables: [],
   ...extra,
   ...(withoutApplication ? { applicationId: "" } : {}),
});
const save = (time: number, clipId: string, extra: Partial<Extract<StatsEventInput, { type: "save" }>> = {}) =>
   event(time, { type: "save", clipId, seconds: 30, outcome: "saved", application: "deep-rock", source: "Deep Rock", ...extra });
const view = (time: number, clipId: string, watched = Array<number>(watchedBuckets).fill(1)) =>
   event(time, { type: "view", clipId, seconds: 20, duration: 30, watched, completed: true });

describe("summarizeStats", () => {
   it("splits capture time across midnight and hours", () => {
      const startedAt = at(3, 23, 30);
      const summary = summarizeStats(
         [event(startedAt + 3_600_000, { type: "capture", startedAt, seconds: 3600, sourceKind: "app", application: "deep-rock" })],
         [],
         {
            now: at(5, 12),
         }
      );
      expect(summary.days.map((day) => [day.date, day.captureSeconds])).toEqual([
         ["2026-11-03", 1800],
         ["2026-11-04", 1800],
      ]);
      expect(summary.hours.captureSeconds[23]).toBe(1800);
      expect(summary.hours.captureSeconds[0]).toBe(1800);
      expect(summary.capture.bySourceKind.app).toBe(3600);
   });

   it("ranks applications, clips and save triggers", () => {
      const events = [
         save(at(2, 20), "a", { trigger: "shortcut", latencyMs: 400, bufferSeconds: 60 }),
         save(at(2, 21), "b", { trigger: "shortcut", latencyMs: 900, bufferSeconds: 60 }),
         save(at(2, 22), "c", { trigger: "tray", latencyMs: 600, application: "valorant", source: "VALORANT" }),
         save(at(2, 22, 5), "d", { outcome: "extended", into: "c", application: "valorant", source: "VALORANT" }),
         save(at(2, 22, 10), "e", { application: "valorant", source: "VALORANT" }),
         view(at(3, 10), "b"),
         view(at(3, 11), "b"),
         view(at(3, 12), "a"),
      ];
      const summary = summarizeStats(events, [clip("a"), clip("b")], { now: at(4, 12) });
      expect(summary.applications.map((entry) => [entry.name, entry.moments, entry.views])).toEqual([
         ["VALORANT", 3, 0],
         ["Deep Rock", 2, 3],
      ]);
      expect(summary.saves).toMatchObject({ moments: 5, newClips: 4, extensions: 1, triggers: { shortcut: 2, tray: 1, app: 0, command: 0 }, bufferUse: 0.5 });
      expect(summary.saves.latency).toEqual({ median: 600, p95: 900, fastest: 400 });
      expect(summary.watching.topClips.map((entry) => [entry.clipId, entry.views, entry.exists])).toEqual([
         ["b", 2, true],
         ["a", 1, true],
      ]);
   });

   it("finds the most replayed moment", () => {
      const watched = Array<number>(watchedBuckets).fill(1);
      watched[16] = 9;
      const summary = summarizeStats([view(at(3, 10), "a", watched)], [clip("a", { duration: 32 })], { now: at(4, 0) });
      expect(summary.watching.topClips[0]!.replayPeak).toBe(16.5);
   });

   it("counts streaks of days with saves", () => {
      const events = [1, 2, 3, 6, 7, 9, 10].map((day) => save(at(day, 18), `clip-${day}`));
      // Day 11 has no save yet, so the streak ending yesterday still counts.
      const summary = summarizeStats(events, [], { now: at(11, 9) });
      expect(summary.streaks).toEqual({ current: 2, longest: 3 });
      expect(summary.activeDays).toBe(7);
      expect(summary.averages.momentsPerActiveDay).toBe(1);
      expect(summarizeStats(events, [], { now: at(13, 9) }).streaks.current).toBe(0);
   });

   it("reports launches, crashes, updates and window time", () => {
      const events = [
         event(at(1, 9), { type: "launch", version: "0.19.0", unclean: false, command: false }),
         event(at(2, 9), { type: "launch", version: "0.20.0", previousVersion: "0.19.0", unclean: true, command: false }),
         event(at(2, 10), { type: "window", seconds: 600 }),
         event(at(2, 11), { type: "settings", keys: ["setupComplete", "clipSeconds"] }),
         event(at(2, 12), { type: "settings", keys: ["clipSeconds"] }),
         event(at(2, 13), { type: "action", action: "rename", clipId: "a" }),
      ];
      const summary = summarizeStats(events, [], { now: at(3, 0) });
      expect(summary.app).toMatchObject({
         launches: 2,
         uncleanExits: 1,
         updates: [{ at: at(2, 9), from: "0.19.0", to: "0.20.0" }],
         windowOpens: 1,
         windowSeconds: 600,
         settingsChanges: 2,
         setupCompletedAt: at(2, 11),
      });
      expect(summary.app.topSettings[0]).toEqual({ key: "clipSeconds", changes: 2 });
      expect(summary.actions.rename).toBe(1);
   });

   it("limits history to a range but keeps the library whole", () => {
      const events = [save(at(1, 12), "a"), save(at(8, 12), "b")];
      const summary = summarizeStats(events, [clip("a"), clip("b", { source: "Desktop", watched: true }, true)], { now: at(9, 0), from: at(7, 0) });
      expect(summary.saves.moments).toBe(1);
      expect(summary.since).toBe(at(8, 12));
      expect(summary.library).toMatchObject({ clips: 2, unwatched: 1, seconds: 60 });
      expect(summary.library.applications.map((entry) => [entry.key, entry.clips])).toEqual([
         ["deep-rock", 1],
         ["source:Desktop", 1],
      ]);
   });

   it("summarizes cleanup and sharing", () => {
      const events = [
         event(at(5, 12), { type: "delete", clipId: "a", scope: "clip", clipCreatedAt: at(1, 12), duration: 30, watched: false }),
         event(at(5, 12), { type: "delete", clipId: "b", scope: "shareable", clipCreatedAt: at(1, 12), duration: 30, watched: true }),
         event(at(5, 13), { type: "shareable", clipId: "c", targetMB: 10, bytes: 10, sourceBytes: 110, encodeSeconds: 4, automatic: true }),
         event(at(5, 14), { type: "copy", clipId: "c", file: "shareable", method: "drag" }),
      ];
      const shareable = { id: "s", path: "/clips/s.mp4", relativePath: "s.mp4", size: 7, targetMB: 10, createdAt: at(5, 13) };
      const summary = summarizeStats(events, [clip("c", { shareables: [shareable] })], { now: at(6, 0) });
      expect(summary.cleanup).toEqual({
         deleted: 2,
         deletedClips: 1,
         deletedShareables: 1,
         deletedUnwatched: 1,
         averageAgeDays: 4,
         keepRate: { all: 0.5, watched: null, unwatched: 0.5 },
      });
      expect(summary.sharing).toMatchObject({
         shareables: 1,
         automatic: 1,
         bytes: 10,
         bytesSaved: 100,
         copies: { drag: 1, clipboard: 0, shareable: 1, clip: 0 },
      });
      expect(summary.library.shareableBytes).toBe(7);
   });

   it("splits the keep rate by watched clips and limits it to clips made in the range", () => {
      const deleted = (clipId: string, created: number, watched: boolean) =>
         event(at(8, 12), { type: "delete", clipId, scope: "clip", clipCreatedAt: created, duration: 30, watched });
      const events = [deleted("old", at(1, 12), true), deleted("w", at(7, 12), true), deleted("u1", at(7, 12), false), deleted("u2", at(7, 12), false)];
      const library = [
         clip("a", { createdAt: at(7, 13), watched: true }),
         clip("b", { createdAt: at(7, 14), watched: true }),
         clip("c", { createdAt: at(7, 15) }),
         clip("before", { createdAt: at(1, 12), watched: true }),
      ];
      expect(summarizeStats(events, library, { now: at(9, 0), from: at(7, 0) }).cleanup.keepRate).toEqual({ all: 0.5, watched: 0.667, unwatched: 0.333 });
      // Without a range, the clip made before it and the one deleted from then count too.
      expect(summarizeStats(events, library, { now: at(9, 0) }).cleanup.keepRate).toEqual({ all: 0.5, watched: 0.6, unwatched: 0.333 });
   });

   it("returns empty figures without history", () => {
      const summary = summarizeStats([], [], { now: at(1, 0) });
      expect(summary.since).toBeNull();
      expect(summary.saves.latency).toBeNull();
      expect(summary.streaks).toEqual({ current: 0, longest: 0 });
      expect(summary.library.oldest).toBeNull();
   });
});
