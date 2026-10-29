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

export const filenamePatterns = { "source-date": "{source} {date} {time}", "date-source": "{date} {time} {source}" } as const;

export function filenameTemplateError(template: string): string {
   if (!template.trim()) return "Enter a file name pattern.";
   if (template.length > 160) return "Keep the pattern under 161 characters.";
   if (/[<>:"/\\|?*]/.test(template) || [...template].some((character) => character.charCodeAt(0) < 32))
      return 'File names cannot contain < > : " / \\ | ? * or control characters.';
   if (/[{}]/.test(template.replace(/\{(?:source|date|time)\}/g, ""))) return "Use only {source}, {date}, and {time} fields.";
   return "";
}

export function validFilenameTemplate(template: string): boolean {
   return !filenameTemplateError(template);
}

export function filenameTemplateWarning(template: string): string {
   if (filenameTemplateError(template)) return "";
   if (/[.]$/.test(template.trim())) return "Trailing periods will be removed from saved names.";
   const expanded = template.replace(/\{(?:source|date|time)\}/g, "Example").trim();
   if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(expanded)) return "Windows reserves this name. AcroClip will use Clip instead.";
   if (!template.includes("{time}")) return "This pattern can give several clips the same name.";
   if (!template.includes("{date}")) return "This pattern can repeat on different days.";
   return "";
}

export function previewFilename(preferences: Pick<Preferences, "filenamePreset" | "filenameTemplate">, source: string, now: Date): string {
   const label = safeFileStem(source);
   const stamp = now
      .toISOString()
      .replaceAll(":", "-")
      .replace(/\.\d+Z$/, "");
   const values = { source: label, date: stamp.slice(0, 10), time: stamp.slice(11) };
   let name: string;
   if (preferences.filenamePreset === "custom") {
      if (!validFilenameTemplate(preferences.filenameTemplate)) throw new Error("Use {source}, {date}, or {time} in a filename without folder separators.");
      name = safeFileStem(
         preferences.filenameTemplate.trim().replace(/\{(source|date|time)\}/g, (_token: string, key: string) => values[key as keyof typeof values])
      );
   } else
      name = filenamePatterns[preferences.filenamePreset].replace(
         /\{(source|date|time)\}/g,
         (_token: string, key: string) => values[key as keyof typeof values]
      );
   return `${name}.mkv`;
}
