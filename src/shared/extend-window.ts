/**
 * How soon a save must follow the previous one to extend it. Extending is for
 * one moment that kept going. Two moments further apart read better as two
 * clips, each ending on its own moment, and a moment's length does not grow
 * with the clip length.
 */
export function extendWindowSeconds(clipSeconds: number): number {
   return Math.min(60, clipSeconds / 2);
}
