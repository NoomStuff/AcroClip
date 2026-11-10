import { describe, expect, it } from "vitest";
import { bugReportUrl, describeSystem, logArchiveName } from "./diagnostics";

describe("bugReportUrl", () => {
   it("opens the bug form with what the app knows", () => {
      const url = new URL(bugReportUrl({ version: "0.20.0", system: "Windows 11 (10.0.26100) x64", archive: "AcroClip-logs.zip" }));
      expect(url.origin + url.pathname).toBe("https://github.com/NoomStuff/AcroClip/issues/new");
      expect(Object.fromEntries(url.searchParams)).toEqual({
         template: "bug-report.yml",
         version: "0.20.0",
         system: "Windows 11 (10.0.26100) x64",
         logs: "Attach AcroClip-logs.zip here (drag it into this box).",
      });
   });
});

describe("describeSystem", () => {
   it("names Windows releases by build", () => {
      expect(describeSystem({ platform: "win32", release: "10.0.26100", arch: "x64" })).toBe("Windows 11 (10.0.26100) x64");
      expect(describeSystem({ platform: "win32", release: "10.0.19045", arch: "x64" })).toBe("Windows 10 (10.0.19045) x64");
   });

   it("includes the Linux session type and desktop", () => {
      expect(describeSystem({ platform: "linux", release: "6.12.1", arch: "x64", wayland: true, desktop: "KDE" })).toBe("Linux 6.12.1 x64 Wayland (KDE)");
      expect(describeSystem({ platform: "darwin", release: "24.1.0", arch: "arm64", macVersion: "15.1" })).toBe("macOS 15.1 arm64");
   });
});

describe("logArchiveName", () => {
   it("sorts by date", () => {
      expect(logArchiveName(new Date(2026, 10, 9, 8, 5, 3))).toBe("AcroClip-logs-2026-11-09-080503.zip");
   });
});
