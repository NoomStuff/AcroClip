export interface LibraryWorkState {
   /** Capture is running or starting. */
   capturing: boolean;
   /** AcroClip is hidden, unfocused for a while, or behind a fullscreen app. */
   background: boolean;
   /** Logical processors on this machine. */
   processors: number;
}

/**
 * How many files the library reads, or thumbnails it makes, at once. Capture and games keep the
 * machine, so they get one. Otherwise the library uses half the processors, from 2 up to 8, since
 * opening a large collection only needs it once.
 */
export function libraryWorkers({ capturing, background, processors }: LibraryWorkState): number {
   if (capturing || background) return 1;
   return Math.max(2, Math.min(8, Math.floor(processors / 2)));
}

/**
 * Threads for one shareable encode, where 0 lets the encoder fill the machine. Someone looking at
 * AcroClip is waiting on it, so it gets everything. Behind a game it gets a quarter of the processors,
 * which leaves the game and the recorder theirs. Encodes run below normal priority either way.
 */
export function shareableThreads({ background, processors }: Omit<LibraryWorkState, "capturing">): number {
   return background ? Math.max(2, Math.floor(processors / 4)) : 0;
}
