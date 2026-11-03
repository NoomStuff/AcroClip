const known: Record<string, string> = {
   explorer: "Explorer",
   "windows explorer": "Explorer",
   "file explorer": "Explorer",
   "google chrome": "Google Chrome",
   "microsoft edge": "Microsoft Edge",
   firefox: "Firefox",
   "visual studio code": "Visual Studio Code",
   discord: "Discord",
   steam: "Steam",
   "obs studio": "OBS Studio",
};

export function normalizeApplicationLabel(name: string): string {
   const trimmed = name.trim();
   if (/^(?:screen|display|monitor)\s*\d+$/i.test(trimmed) || /^desktop$/i.test(trimmed)) return "Desktop";
   const tail = trimmed.split(/\s+[─–—-]\s+/).at(-1) ?? trimmed;
   return known[tail.toLowerCase()] ?? trimmed;
}
