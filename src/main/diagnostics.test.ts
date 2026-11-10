import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Diagnostics, LogFile, homeRedactor, readSession } from "./diagnostics";
import { bugReportUrl } from "../shared/diagnostics";

const folders: string[] = [];
afterEach(async () => {
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function folder() {
   const directory = await mkdtemp(join(tmpdir(), "acroclip-diagnostics-"));
   folders.push(directory);
   return directory;
}

describe("LogFile", () => {
   it("keeps one previous file when it rotates", async () => {
      const directory = await folder();
      const file = new LogFile(join(directory, "app.log"), 10);
      file.write("first line that is long\n");
      await file.flush();
      file.write("second\n");
      await file.flush();
      file.write("third\n");
      await file.flush();
      expect(await readFile(join(directory, "app.log.previous"), "utf8")).toBe("first line that is long\n");
      expect(await readFile(join(directory, "app.log"), "utf8")).toBe("second\nthird\n");
   });

   it("writes synchronously for a dying process", async () => {
      const directory = await folder();
      const file = new LogFile(join(directory, "nested", "app.log"), 1000, 60_000);
      file.write("pending\n");
      file.flushSync();
      expect(await readFile(join(directory, "nested", "app.log"), "utf8")).toBe("pending\n");
   });
});

describe("Diagnostics", () => {
   it("reports a run that never closed cleanly", async () => {
      const directory = await folder();
      let now = 1000;
      const first = new Diagnostics({ directory, version: "0.19.0", pid: 1, now: () => now });
      expect(await first.begin()).toBeNull();
      first.crashed("TypeError: x is undefined");
      now = 2000;
      const second = new Diagnostics({ directory, version: "0.20.0", pid: 2, now: () => now });
      expect(await second.begin()).toMatchObject({ version: "0.19.0", clean: false, crash: "TypeError: x is undefined" });
      second.end();
      expect(readSession(directory)).toMatchObject({ version: "0.20.0", clean: true, endedAt: 2000 });
      const third = new Diagnostics({ directory, version: "0.20.0", pid: 3, now: () => now });
      expect(await third.begin()).toMatchObject({ clean: true });
      expect((await third.history()).map((session) => [session.version, session.clean])).toEqual([
         ["0.19.0", false],
         ["0.20.0", true],
      ]);
   });

   it("ignores a damaged session marker", async () => {
      const directory = await folder();
      await writeFile(join(directory, "session.json"), "{not json");
      expect(await new Diagnostics({ directory, version: "1.0.0" }).begin()).toBeNull();
   });

   it("timestamps recorder output by line and holds partial lines", async () => {
      const directory = await folder();
      const diagnostics = new Diagnostics({ directory, version: "1.0.0", now: () => Date.UTC(2026, 10, 10, 12) });
      diagnostics.recorderStarted("screen");
      diagnostics.recorderOutput("obs: video ");
      diagnostics.recorderOutput("reset\nobs: audio ok\nobs: par");
      await diagnostics.flush();
      const text = await readFile(join(directory, "recorder.log"), "utf8");
      expect(text).toContain("===== recorder started: screen =====");
      expect(text).toContain("2026-11-10T12:00:00.000Z obs: video reset\n2026-11-10T12:00:00.000Z obs: audio ok\n");
      expect(text).not.toContain("par");
   });

   it("exports every log with the home folder removed", async () => {
      const directory = await folder();
      const diagnostics = new Diagnostics({ directory, version: "1.0.0" });
      await diagnostics.begin();
      diagnostics.log("opened /home/alex/Videos/AcroClip", "warn");
      diagnostics.recorderOutput("loaded /home/alex/.config/obs\n");
      const entries = await diagnostics.entries(homeRedactor("/home/alex", "linux"));
      const names = entries.map((entry) => entry.name);
      expect(names).toEqual(["logs/app.log", "logs/recorder.log"]);
      expect(String(entries[0]!.data)).toMatch(/WARN {2}opened ~\/Videos\/AcroClip/);
      expect(String(entries[1]!.data)).toContain("loaded ~/.config/obs");
   });
});

describe("homeRedactor", () => {
   it("matches Windows paths in either case and slash direction", () => {
      const redact = homeRedactor("C:\\Users\\Alex", "win32");
      expect(redact("C:\\Users\\Alex\\Videos and c:/users/alex/AppData and C:\\\\Users\\\\Alex\\\\x")).toBe("~\\Videos and ~/AppData and ~\\\\x");
   });

   it("leaves text alone without a usable home", () => {
      expect(homeRedactor("/", "linux")("/etc/passwd")).toBe("/etc/passwd");
   });
});

describe("bug report form", () => {
   it("has a field for every value the app prefills", () => {
      const form = readFileSync(".github/ISSUE_TEMPLATE/bug-report.yml", "utf8");
      const url = new URL(bugReportUrl({ version: "1.0.0", system: "Linux", archive: "logs.zip" }));
      expect(form).toContain(`name: Bug report`);
      expect(url.searchParams.get("template")).toBe("bug-report.yml");
      for (const key of [...url.searchParams.keys()].filter((key) => key !== "template")) expect(form).toMatch(new RegExp(`^\\s+id: ${key}$`, "m"));
   });
});
