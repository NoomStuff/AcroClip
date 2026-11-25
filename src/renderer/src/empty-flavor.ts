/**
 * Empty states rotate their title once a day, so the app doesn't say the same line forever
 * but a title never changes while you look at it. The detail line stays fixed and plain.
 */
export function dailyLine(lines: readonly [string, ...string[]], key: string, now = new Date()): string {
   const seed = `${key}:${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
   let hash = 0;
   for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
   return lines[hash % lines.length]!;
}

export const emptyTitles = {
   library: ["Nothing saved yet", "Clean slate", "No clips. Yet.", "Quiet in here"],
   folder: ["This folder is empty", "Nothing in here yet"],
   player: ["Nothing playing", "The stage is empty", "Pick a clip, any clip"],
} as const satisfies Record<string, readonly [string, ...string[]]>;

/** A search that found nothing names what was typed. Nobody types a 50 letter word, or 50 words, by accident. */
export function noMatchTitle(query: string, now = new Date()): string {
   const words = query.split(/\s+/).filter(Boolean);
   if (words.length > 50 || words.some((word) => word.length > 50)) return "bro stop";
   return dailyLine([`Nothing matches "${query}"`, `No sign of "${query}"`, `Zero hits for "${query}"`], "search", now);
}

/** Matches any of a state's titles, for checks that can't know which one today's seed picked. */
export function anyTitle(lines: readonly string[]): RegExp {
   const escaped = lines.map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
   return new RegExp(`^(${escaped.join("|")})$`);
}
