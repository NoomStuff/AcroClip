import type { Preferences } from "./types";

export function safeFileStem(value: string): string {
   const clean = value
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100);
   const result = [...clean].filter((character) => character.charCodeAt(0) >= 32).join("");
   if (!result || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) return "Clip";
   return result;
}

export const filenamePatterns = {
   "source-date": "{source} {date} {time}",
   "date-source": "{date} {time} {source}",
   replay: "Replay {date} {time}",
   compact: "{source}_{year}{month}{day}_{hour}{minute}{second}",
} as const;

/** Every field a name pattern can use, in the order the editor offers them. */
export const filenameFields = [
   { token: "{source}", name: "Application" },
   { token: "{date}", name: "Date" },
   { token: "{time}", name: "Time" },
   { token: "{year}", name: "Year" },
   { token: "{month}", name: "Month" },
   { token: "{day}", name: "Day" },
   { token: "{hour}", name: "Hour" },
   { token: "{minute}", name: "Minute" },
   { token: "{second}", name: "Second" },
   { token: "{weekday}", name: "Weekday" },
] as const;
type FilenameField = (typeof filenameFields)[number]["token"] extends `{${infer Name}}` ? Name : never;
const fieldPattern = /\{(source|date|time|year|month|day|hour|minute|second|weekday)\}/g;
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function filenameTemplateError(template: string): string {
   if (!template.trim()) return "Enter a file name pattern.";
   if (template.length > 160) return "Keep the pattern under 161 characters.";
   if (/[<>:"/\\|?*]/.test(template) || [...template].some((character) => character.charCodeAt(0) < 32))
      return 'File names cannot contain < > : " / \\ | ? * or control characters.';
   if (/[{}]/.test(template.replace(fieldPattern, ""))) return "Use only the fields below, such as {source} or {date}.";
   return "";
}

export function validFilenameTemplate(template: string): boolean {
   return !filenameTemplateError(template);
}

export function filenameTemplateWarning(template: string): string {
   if (filenameTemplateError(template)) return "";
   if (/[.]$/.test(template.trim())) return "Trailing periods will be removed from saved names.";
   const expanded = template.replace(fieldPattern, "Example").trim();
   if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(expanded)) return "Windows reserves this name. AcroClip will use Clip instead.";
   const has = (...fields: FilenameField[]) => fields.every((field) => template.includes(`{${field}}`));
   if (!has("time") && !has("hour", "minute", "second")) return "This pattern can give several clips the same name.";
   if (!has("date") && !has("year", "month", "day")) return "This pattern can repeat on different days.";
   return "";
}

// Names use the local clock people read. Stored times stay UTC epoch values.
function localFields(now: Date): Record<Exclude<FilenameField, "source">, string> {
   const pad = (value: number) => String(value).padStart(2, "0");
   const year = String(now.getFullYear()),
      month = pad(now.getMonth() + 1),
      day = pad(now.getDate()),
      hour = pad(now.getHours()),
      minute = pad(now.getMinutes()),
      second = pad(now.getSeconds());
   return { date: `${year}-${month}-${day}`, time: `${hour}-${minute}-${second}`, year, month, day, hour, minute, second, weekday: weekdays[now.getDay()]! };
}

export function previewFilename(preferences: Pick<Preferences, "filenamePreset" | "filenameTemplate">, source: string, now: Date): string {
   const values: Record<FilenameField, string> = { source: safeFileStem(source), ...localFields(now) };
   const fill = (pattern: string) => pattern.replace(fieldPattern, (_token: string, key: string) => values[key as FilenameField]);
   let name: string;
   if (preferences.filenamePreset === "custom") {
      if (!validFilenameTemplate(preferences.filenameTemplate)) throw new Error("Use the file name fields without folder separators.");
      name = safeFileStem(fill(preferences.filenameTemplate.trim()));
   } else name = fill(filenamePatterns[preferences.filenamePreset]);
   // MP4 plays inline in chat apps, phones and browsers. MKV clips stay supported.
   return `${name}.mp4`;
}
