import { describe, expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { previewFilename, validFilenameTemplate, filenameFields, filenameTemplateError, filenameTemplateWarning } from "./filename";

describe("custom recording filenames", () => {
   it("rejects folder paths, unsupported tokens, and control characters", () => {
      for (const template of ["../{source}", "Clips\\{date}", "{unknown}", "{source", "Title\n{time}", " "])
         expect(validFilenameTemplate(template)).toBe(false);
      expect(validFilenameTemplate("{source} on {date} at {time}")).toBe(true);
   });
   it("previews the default pattern without an unexplained sample ID", () => {
      expect(previewFilename(defaultPreferences, "Game", new Date(2026, 9, 8, 12, 0, 0))).toBe("Game 2026-10-08 12-00-00.mp4");
   });
   it("names clips on the local clock, across daylight saving changes", () => {
      const previous = process.env["TZ"];
      process.env["TZ"] = "Europe/Amsterdam";
      try {
         expect(previewFilename(defaultPreferences, "Game", new Date("2026-11-08T20:28:42Z"))).toBe("Game 2026-11-08 21-28-42.mp4");
         expect(previewFilename(defaultPreferences, "Game", new Date("2026-07-08T19:28:42Z"))).toBe("Game 2026-07-08 21-28-42.mp4");
         expect(previewFilename(defaultPreferences, "Game", new Date("2026-11-08T23:30:00Z"))).toBe("Game 2026-11-09 00-30-00.mp4");
      } finally {
         if (previous === undefined) delete process.env["TZ"];
         else process.env["TZ"] = previous;
      }
   });
   it("explains invalid syntax and names that require sanitizing", () => {
      expect(filenameTemplateError("Bad:name")).toContain("cannot contain");
      expect(filenameTemplateError("{unknown}")).toContain("Use only");
      expect(filenameTemplateWarning("CON")).toContain("Windows reserves");
      expect(filenameTemplateWarning("CON.{time}")).toContain("Windows reserves");
      expect(filenameTemplateWarning("Clip. ")).toContain("will be removed");
      expect(validFilenameTemplate("CON")).toBe(true);
      expect(previewFilename({ filenamePreset: "custom", filenameTemplate: "CON" }, "Game", new Date())).toBe("Clip.mp4");
   });
   it("warns about names that repeat without weakening overwrite protection", () => {
      expect(filenameTemplateWarning("{source} {date}")).toContain("same name");
      expect(filenameTemplateWarning("{source} {time}")).toContain("different days");
      expect(filenameTemplateWarning("{source} {date} {time}")).toBe("");
      expect(filenameTemplateWarning("../invalid")).toBe("");
      // Separate date and time fields count as the whole date and time.
      expect(filenameTemplateWarning("{source}_{year}{month}{day}_{hour}{minute}{second}")).toBe("");
      expect(filenameTemplateWarning("{source} {year}{month}{day} {hour}{minute}")).toContain("same name");
      expect(filenameTemplateWarning("{source} {weekday} {time}")).toContain("different days");
   });
   it("fills every field and preset on the local clock", () => {
      const at = new Date(2026, 9, 8, 9, 5, 7);
      expect(previewFilename({ filenamePreset: "replay", filenameTemplate: "" }, "Game", at)).toBe("Replay 2026-10-08 09-05-07.mp4");
      expect(previewFilename({ filenamePreset: "compact", filenameTemplate: "" }, "Game", at)).toBe("Game_20261008_090507.mp4");
      expect(
         previewFilename({ filenamePreset: "custom", filenameTemplate: "{weekday} {day}.{month}.{year} {hour}h{minute}m{second}s {source}" }, "Game", at)
      ).toBe("Thursday 08.10.2026 09h05m07s Game.mp4");
      for (const field of filenameFields) expect(validFilenameTemplate(`Clip ${field.token}`)).toBe(true);
   });
   it("sanitizes captured window titles without adding IDs", () => {
      const preferences = { ...defaultPreferences, filenamePreset: "custom" as const, filenameTemplate: "{date} - {source}" };
      const filename = previewFilename(preferences, "../../Game: title", new Date(2026, 9, 8, 12, 0, 0));
      expect(filename).not.toContain("/");
      expect(filename).not.toContain(":");
      expect(filename).toBe("2026-10-08 - .._.._Game_ title.mp4");
   });
   it("silently trims surrounding whitespace", () => {
      expect(filenameTemplateWarning("  {source} {date} {time}  ")).toBe("");
      expect(
         previewFilename(
            { ...defaultPreferences, filenamePreset: "custom", filenameTemplate: "  {source} {date} {time}  " },
            "Game",
            new Date(2026, 9, 8, 12, 0, 0)
         )
      ).toBe("Game 2026-10-08 12-00-00.mp4");
   });
});
