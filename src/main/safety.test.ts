import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultPreferences } from "../shared/defaults";
import { isValidShortcut, recordingDestination } from "./safety";
import { safeFileStem } from "../shared/filename";
import { desktopExec } from "./startup";

describe("recording destination safety", () => {
   it("keeps application names from escaping the chosen recording folder", () => {
      const prefs = { ...defaultPreferences, collection: "/clips", folderLayout: "application" as const };
      const destination = recordingDestination(prefs, "../../App: title", new Date("2026-10-08T12:00:00Z"));
      expect(destination).toBe(join("/clips", ".._.._App_ title", ".._.._App_ title 2026-10-08 12-00-00.mkv"));
      expect(safeFileStem("CON")).toBe("Clip");
      expect(safeFileStem("\u0000")).toBe("Clip");
   });
   it("preserves existing and unfinished files and reserves pending save paths", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-names-"));
      try {
         const prefs = { ...defaultPreferences, collection: root, filenamePreset: "custom" as const, filenameTemplate: "Moment" };
         const first = recordingDestination(prefs, "Game");
         expect(first).toBe(join(root, "Moment.mkv"));
         const second = recordingDestination(prefs, "Game", new Date(), [first]);
         expect(second).toBe(join(root, "Moment (2).mkv"));
         if (process.platform !== "linux") expect(recordingDestination(prefs, "Game", new Date(), [first.toUpperCase()])).toBe(second);
         await writeFile(first, "existing recording");
         await writeFile(`${second}.saving.mkv`, "unfinished recording");
         const third = recordingDestination(prefs, "Game");
         expect(third).toBe(join(root, "Moment (3).mkv"));
         expect(recordingDestination(prefs, "Game", new Date(), [third])).toBe(join(root, "Moment (4).mkv"));
         expect(await readFile(first, "utf8")).toBe("existing recording");
         expect(await readFile(`${second}.saving.mkv`, "utf8")).toBe("unfinished recording");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
});
describe("shortcut and startup validation", () => {
   it("rejects malformed accelerators before Electron receives them", () => {
      expect(isValidShortcut("CommandOrControl+Shift+F8")).toBe(true);
      expect(isValidShortcut("Alt+C")).toBe(true);
      expect(isValidShortcut("Control+Shift+K")).toBe(true);
      expect(isValidShortcut("Control++")).toBe(false);
      expect(isValidShortcut("Control+Control+K")).toBe(false);
      expect(isValidShortcut("Meta+UnknownKey")).toBe(false);
   });
   it("quotes Linux executable paths and escapes desktop entry interpolation", () => {
      expect(desktopExec("/home/user/My App%/AcroClip", ["/project/path"])).toBe('"/home/user/My App%%/AcroClip" "/project/path"');
   });
});
