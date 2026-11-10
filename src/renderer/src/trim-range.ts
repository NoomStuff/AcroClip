/** The part of a clip a trim keeps, in seconds of the clip's own timeline. */
export interface TrimRange {
   start: number;
   end: number;
}
export type TrimEdge = "start" | "end";

/** The shortest part a trim keeps. A tenth of a second, or two frames of a very slow clip. */
export function minimumTrimLength(frameRate: number | undefined): number {
   return Math.max(0.1, frameRate && frameRate > 0 ? 2 / frameRate : 0);
}
/** One arrow key press moves a handle one frame. Clips of unknown rate move a thirtieth of a second. */
export function trimStep(frameRate: number | undefined): number {
   return 1 / (frameRate && frameRate > 0 ? Math.min(frameRate, 240) : 30);
}
/** Moves one edge to `value`, inside the clip and no closer to the other edge than the minimum. */
export function moveTrimEdge(range: TrimRange, edge: TrimEdge, value: number, duration: number, minimum: number): TrimRange {
   const gap = Math.min(minimum, duration);
   if (edge === "start") return { start: Math.min(Math.max(0, value), Math.max(0, range.end - gap)), end: range.end };
   return { start: range.start, end: Math.max(Math.min(duration, value), Math.min(duration, range.start + gap)) };
}
/** Whether a range leaves anything out. A handle within a frame of the edge still counts as untouched. */
export function trims(range: TrimRange, duration: number, frameRate: number | undefined): boolean {
   const tolerance = trimStep(frameRate) / 2;
   return range.start > tolerance || range.end < duration - tolerance;
}
/** Just before the end, which shows the last frame the trim keeps instead of the first one it drops. */
export function lastKeptTime(range: TrimRange): number {
   return Math.max(range.start, range.end - 0.001);
}
/** Minutes, seconds and tenths, like 1:04.3. Tenths round down, so the end of a clip never reads past its length. */
export function formatTrimTime(seconds: number): string {
   const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
   const whole = Math.floor(tenths / 10);
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}
