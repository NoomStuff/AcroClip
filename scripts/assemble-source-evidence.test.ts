import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkRuntimeVersions, copyNativeLicenses } from "./assemble-source-evidence";

describe("controlled media notices in the runtime package", () => {
   const folders: string[] = [];
   afterEach(async () => {
      await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
   });
   it("retains a compiled dependency's full copyright and license in the installer notices", async () => {
      const project = await mkdtemp(path.join(os.tmpdir(), "acroclip-source-notices-"));
      folders.push(project);
      const directory = path.join(project, "work/release-sources");
      const licensePath = "evidence/controlled-media/licenses/dav1d/COPYING";
      const license = Buffer.from(
         "Copyright (c) 2018, VideoLAN and dav1d authors\nAll rights reserved.\nRedistribution and use in source and binary forms...\n"
      );
      const source = path.join(directory, licensePath);
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, license);
      await copyNativeLicenses(project, directory, [{ path: licensePath, sha256: createHash("sha256").update(license).digest("hex"), size: license.length }]);
      const digest = createHash("sha256").update(license).digest("hex");
      expect(await readFile(path.join(project, "resources/notices/native", `${digest}.txt`))).toEqual(license);
      expect(JSON.parse(await readFile(path.join(project, "resources/notices/native/index.json"), "utf8"))).toEqual({
         version: 1,
         licenses: [{ source: licensePath, path: `${digest}.txt`, sha256: digest, size: license.length }],
      });
      expect(await readFile(source)).toEqual(license);
   });
   it("retains distinct same-named licenses with short installed paths and replaces the previous generated tree", async () => {
      const project = await mkdtemp(path.join(os.tmpdir(), "acroclip-source-notices-"));
      folders.push(project);
      const directory = path.join(project, "work/release-sources");
      const records: { path: string; sha256: string; size: number }[] = [];
      for (const component of ["first", "second"]) {
         const relative = `evidence/${component}/${"long-upstream-directory/".repeat(7)}COPYING`;
         const bytes = Buffer.from(`Full original copyright and license for ${component}\n`);
         const source = path.join(directory, relative);
         await mkdir(path.dirname(source), { recursive: true });
         await writeFile(source, bytes);
         records.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
      }
      const old = path.join(project, "resources/notices/native/old/COPYING");
      await mkdir(path.dirname(old), { recursive: true });
      await writeFile(old, "Retain the old generated notice for diagnostics");
      await copyNativeLicenses(project, directory, records);
      const native = path.join(project, "resources/notices/native");
      expect((await readdir(native)).sort()).toEqual([...records.map((r) => `${r.sha256}.txt`), "index.json"].sort());
      for (const record of records) {
         const installed = path.win32.join(
            "C:/Users/runneradmin/AppData/Local/Temp",
            `acroclip-upgrade-${"0".repeat(32)}`,
            "custom folder",
            "resources/notices/native",
            `${record.sha256}.txt`
         );
         expect(installed.length).toBeLessThan(260);
         expect(await readFile(path.join(native, `${record.sha256}.txt`))).toEqual(await readFile(path.join(directory, record.path)));
      }
      const backup = (await readdir(path.join(project, "work"))).find((name) => name.startsWith("native-notices-"))!;
      expect(await readFile(path.join(project, "work", backup, "previous/old/COPYING"), "utf8")).toBe("Retain the old generated notice for diagnostics");
   });
   it("rejects changed license text and paths outside the source kit", async () => {
      const project = await mkdtemp(path.join(os.tmpdir(), "acroclip-source-notices-"));
      folders.push(project);
      const directory = path.join(project, "work/release-sources");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "COPYING"), "changed");
      await expect(copyNativeLicenses(project, directory, [{ path: "COPYING", sha256: "original", size: 7 }])).rejects.toThrow("license changed");
      await expect(copyNativeLicenses(project, directory, [{ path: "../COPYING", sha256: "original", size: 7 }])).rejects.toThrow("path escapes");
   });
});

describe("actual OBS dependency identity", () => {
   const libraries = [
      { file: "libcurl.dll", sha256: "curl-sha", version: "libcurl/8.12.1-DEV Schannel" },
      { file: "librist.dll", sha256: "rist-sha", version: "v0.2.7-1-g809390b" },
      { file: "libx264-164.dll", sha256: "x264-sha", version: "r3106", commitPrefix: "eaa68fa" },
   ];
   const probe = { file: "avcodec-62.dll", sha256: "codec-sha", configuration: "", version: 0, libraries };
   const staged = libraries.map((library) => ({ path: `recorder/${library.file}`, sha256: library.sha256 }));
   const inputs = [
      { file: "libcurl.dll", version: "8.12.1", commit: "57495c64871d18905a0941db9196ef90bafe9a29" },
      { file: "librist.dll", version: "0.2.7", commit: "809390b3b75a259a704079d0fb4d8f1b5f7fa956" },
      { file: "libx264-164.dll", version: "r3106", commit: "eaa68fad9e5d201d42fde51665f2d137ae96baf0" },
   ];
   it("accepts staged hashes and actual embedded versions including development suffixes", () => {
      expect(() => checkRuntimeVersions(probe, staged, inputs)).not.toThrow();
   });
   it("rejects a changed DLL even when its version string still matches", () => {
      expect(() => checkRuntimeVersions(probe, [{ path: staged[0]!.path, sha256: "changed" }, ...staged.slice(1)], inputs)).toThrow("different library");
   });
   it("rejects an incorrect source commit for a DLL's embedded revision", () => {
      expect(() => checkRuntimeVersions(probe, staged, [...inputs.slice(0, 2), { ...inputs[2]!, commit: "0000000000000000000000000000000000000000" }])).toThrow(
         "source commit differs"
      );
   });
   it("rejects missing probes and a version mismatch", () => {
      expect(() => checkRuntimeVersions({ ...probe, libraries: libraries.slice(1) }, staged, inputs)).toThrow("probe is missing");
      expect(() => checkRuntimeVersions(probe, staged, [{ ...inputs[0]!, version: "8.11.0" }, ...inputs.slice(1)])).toThrow("version differs");
   });
});
