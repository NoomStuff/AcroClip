import type { CaptureSource, GameCandidate } from "../shared/types";

/**
 * The game a desktop capture shows, when there's a clear one: a recognized game in front, filling
 * the captured screen. Anything less certain, like a game on another monitor or one behind a
 * browser, leaves the clip as plain Desktop. Without monitor details, only a single display counts.
 */
export function desktopGame(
   candidates: readonly GameCandidate[],
   captured: Pick<CaptureSource, "bounds"> | undefined,
   displays: number
): GameCandidate | undefined {
   const game = candidates.find((candidate) => candidate.foreground && candidate.fullscreen && candidate.gameId && candidate.gameName);
   if (!game) return undefined;
   const bounds = captured?.bounds;
   if (game.monitor && bounds) {
      const x = (game.monitor.left + game.monitor.right) / 2,
         y = (game.monitor.top + game.monitor.bottom) / 2;
      return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height ? game : undefined;
   }
   return displays === 1 ? game : undefined;
}

/** How far apart two samples can be before the time between them counts as unknown. */
const MAX_SAMPLE_GAP_MS = 12_000;
/** A game takes a clip when it filled at least this much of the footage. */
const MAJORITY = 0.5;
/** A game that was in front when the clip was saved needs less: the moment you reach for the clip button is a strong hint. */
const IN_FRONT_AT_SAVE = 0.25;

/**
 * Remembers which recognized game was in front of a desktop capture, so a clip is credited to the game
 * that filled most of it and not only the one showing at the instant it was saved.
 * Each sample holds until the next, and a long silence between samples counts as unknown, not as the last game.
 */
export class DesktopGameWatch<Game extends { id: string }> {
   private samples: { at: number; game: Game | undefined }[] = [];
   private readonly keepMs: number;
   constructor(keepMs: number) {
      this.keepMs = keepMs;
   }
   /** `game` is who filled the screen at `at`, or nothing. Samples must arrive in time order. */
   record(at: number, game: Game | undefined): void {
      const last = this.samples.at(-1);
      if (last && at < last.at) return;
      this.samples.push({ at, game });
      // One sample before the window is kept, since it still covers the start of it.
      const keepFrom = at - this.keepMs;
      while (this.samples.length > 2 && this.samples[1]!.at < keepFrom) this.samples.shift();
   }
   clear(): void {
      this.samples = [];
   }
   /**
    * The game to credit for footage between `from` and `to`, if one has enough of it. `inFront` is the
    * game on screen right now, which gets the lower bar. Without any samples it is all there is to go on.
    */
   pick(from: number, to: number, inFront: Game | undefined): Game | undefined {
      if (!this.samples.length) return inFront;
      const first = Math.max(from, this.samples[0]!.at);
      const span = to - first;
      if (span <= 0) return inFront;
      const time = new Map<string, { game: Game; ms: number }>();
      this.samples.forEach((sample, index) => {
         if (!sample.game) return;
         const next = this.samples[index + 1]?.at ?? to;
         const start = Math.max(sample.at, first),
            end = Math.min(sample.at + MAX_SAMPLE_GAP_MS, next, to);
         if (end <= start) return;
         const entry = time.get(sample.game.id) ?? { game: sample.game, ms: 0 };
         entry.ms += end - start;
         time.set(sample.game.id, entry);
      });
      const [best] = [...time.values()].sort((a, b) => b.ms - a.ms);
      if (!best) return undefined;
      const share = best.ms / span;
      return share >= MAJORITY || (share >= IN_FRONT_AT_SAVE && inFront?.id === best.game.id) ? best.game : undefined;
   }
}
