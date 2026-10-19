export const gainDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);
export const gainText = (gain: number): string => (gain <= 0 ? "-inf" : `${gain > 1 ? "+" : ""}${gainDb(gain).toFixed(1)}`);
export const boundedGain = (gain: number): number => Math.round(Math.max(0, Math.min(4, gain)) * 100) / 100;
export function parseGain(text: string): number | null {
   if (/^-?inf(inity)?$/i.test(text.trim())) return 0;
   if (!text.trim() || !Number.isFinite(Number(text))) return null;
   return boundedGain(10 ** (Math.max(-80, Math.min(12, Number(text))) / 20));
}
export interface MeterReading {
   level: number;
   peak: number;
   holdUntil: number;
   clipUntil: number;
}
export function advanceMeter(previous: MeterReading, target: number, now: number, elapsed: number): MeterReading {
   const input = Math.max(0, Math.min(100, target));
   const level = Math.max(input, previous.level - (elapsed * 40) / 1000);
   const rising = input >= previous.peak && input > 0;
   const holdUntil = rising ? now + 1500 : previous.holdUntil;
   const peak = rising
      ? input
      : now <= holdUntil
        ? previous.peak
        : Math.max(level, previous.peak - (Math.max(0, Math.min(elapsed, now - holdUntil)) * 20) / 1000);
   return { level, peak, holdUntil, clipUntil: input >= 100 ? now + 1500 : previous.clipUntil };
}
