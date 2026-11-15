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
