import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Enumerate project files without walking downloaded runtimes and source kits.
// Include new files and omit staged deletions, while retaining .prettierignore.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8", windowsHide: true })
   .split("\0")
   .filter((file) => file && existsSync(file));
const result = spawnSync(process.execPath, ["node_modules/prettier/bin/prettier.cjs", "--ignore-unknown", ...process.argv.slice(2), ...files], {
   stdio: "inherit",
   windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
