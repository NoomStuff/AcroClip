import { cp, symlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { windowsDevExecutable } from "../../scripts/windows-dev-identity";

// Load production output as an application, without default_app. This tests the
// real packaged-mode decision instead of changing Electron's read-only flags.
export async function packagedFixture(profile: string): Promise<string> {
   const executable = await windowsDevExecutable(process.cwd());
   if (!executable) throw new Error("The updater fixture requires Windows.");
   const folder = join(profile, "runtime");
   await cp(dirname(executable), folder, { recursive: true });
   await symlink(resolve("."), join(folder, "resources", "app"), "junction");
   await symlink(resolve("resources/recorder"), join(folder, "resources", "recorder"), "junction");
   await symlink(resolve("build"), join(folder, "resources", "icons"), "junction");
   return join(folder, basename(executable));
}
