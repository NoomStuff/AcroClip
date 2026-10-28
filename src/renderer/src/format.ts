export const formatSize = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);
export const formatTime = (seconds: number): string => {
   const whole = Math.max(0, Math.floor(seconds));
   return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};
export const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? "Choose a folder";
export const age = (timestamp: number): string => {
   const minutes = Math.max(0, (Date.now() - timestamp) / 60000);
   if (minutes < 1) return "Just now";
   if (minutes < 60) return `${Math.floor(minutes)}m ago`;
   if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
   return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "always" });
export function timeAgo(timestamp: number, now = Date.now()): string {
   const seconds = Math.max(0, (now - timestamp) / 1000);
   for (const [unit, length] of [
      ["year", 31_536_000],
      ["month", 2_592_000],
      ["week", 604_800],
      ["day", 86_400],
      ["hour", 3600],
      ["minute", 60],
   ] as const) {
      if (seconds >= length) return relativeTime.format(-Math.floor(seconds / length), unit);
   }
   return "just now";
}
