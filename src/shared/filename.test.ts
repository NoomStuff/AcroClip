import { describe, expect, it } from "vitest";
import { defaultPreferences } from "./defaults";
import { previewFilename, validFilenameTemplate, filenameTemplateError, filenameTemplateWarning } from "./filename";

describe("custom recording filenames", () => {
   it("rejects folder paths, unsupported tokens, and control characters", () => {
      for (const template of ["../{source}", "Clips\\{date}", "{unknown}", "{source", "Title\n{time}", " "])
         expect(validFilenameTemplate(template)).toBe(false);
      expect(validFilenameTemplate("{source} on {date} at {time}")).toBe(true);
   });
   it("previews the default pattern without an unexplained sample ID", () => {
      expect(previewFilename(defaultPreferences, "Game", new Date("2026-10-08T12:00:00Z"))).toBe("Game 2026-10-08 12-00-00.mkv");
   });
   it("explains invalid syntax and names that require sanitizing", () => {
      expect(filenameTemplateError("Bad:name")).toContain("cannot contain");
      expect(filenameTemplateError("{unknown}")).toContain("Use only");
      expect(filenameTemplateWarning("CON")).toContain("Windows reserves");
      expect(filenameTemplateWarning("CON.{time}")).toContain("Windows reserves");
      expect(filenameTemplateWarning("Clip. ")).toContain("will be removed");
      expect(validFilenameTemplate("CON")).toBe(true);
      expect(previewFilename({ filenamePreset: "custom", filenameTemplate: "CON" }, "Game", new Date())).toBe("Clip.mkv");
   });
   it("warns about names that repeat without weakening overwrite protection", () => {
      expect(filenameTemplateWarning("{source} {date}")).toContain("same name");
      expect(filenameTemplateWarning("{source} {time}")).toContain("different days");
      expect(filenameTemplateWarning("{source} {date} {time}")).toBe("");
      expect(filenameTemplateWarning("../invalid")).toBe("");
   });
   it("sanitizes captured window titles without adding IDs", () => {
      const preferences = { ...defaultPreferences, filenamePreset: "custom" as const, filenameTemplate: "{date} - {source}" };
      const filename = previewFilename(preferences, "../../Game: title", new Date("2026-10-08T12:00:00Z"));
      expect(filename).not.toContain("/");
      expect(filename).not.toContain(":");
      expect(filename).toBe("2026-10-08 - .._.._Game_ title.mkv");
   });
   it("silently trims surrounding whitespace", () => {
      expect(filenameTemplateWarning("  {source} {date} {time}  ")).toBe("");
      expect(
         previewFilename(
            { ...defaultPreferences, filenamePreset: "custom", filenameTemplate: "  {source} {date} {time}  " },
            "Game",
            new Date("2026-10-08T12:00:00Z")
         )
      ).toBe("Game 2026-10-08 12-00-00.mkv");
   });
});
