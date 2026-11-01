import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linuxStartup } from "../../src/main/startup";

test("Linux desktop launcher preserves literal special characters", async () => {
   test.skip(process.platform !== "linux", "Uses the Linux desktop launcher");
   const profile = await mkdtemp(join(tmpdir(), "acroclip-launcher-"));
   const executable = join(profile, 'AcroClip "quote" $dollar `tick` \\slash %percent');
   const output = join(profile, "arguments.json");
   await writeFile(
      executable,
      '#!/usr/bin/python3\nimport json, os, sys\nwith open(os.environ["ACROCLIP_DESKTOP_ARGUMENTS"], "w") as output:\n    json.dump(sys.argv[1:], output)\n'
   );
   await chmod(executable, 0o700);
   const args = ['literal "quotes"', "$dollar", "`backticks`", "\\backslash", "%field", "tab\tvalue"];
   await linuxStartup(true, profile, executable, args);
   await promisify(execFile)("gio", ["launch", join(profile, "autostart", "acroclip.desktop")], {
      env: { ...process.env, ACROCLIP_DESKTOP_ARGUMENTS: output },
   });
   await expect.poll(async () => JSON.parse(await readFile(output, "utf8").catch(() => "null")) as unknown).toEqual(args);
   const moved = join(profile, "Renamed AcroClip.AppImage");
   await rename(executable, moved);
   const updated = [...args, "after update"];
   await linuxStartup(true, profile, moved, updated);
   await promisify(execFile)("gio", ["launch", join(profile, "autostart", "acroclip.desktop")], {
      env: { ...process.env, ACROCLIP_DESKTOP_ARGUMENTS: output },
   });
   await expect.poll(async () => JSON.parse(await readFile(output, "utf8").catch(() => "null")) as unknown).toEqual(updated);
});
