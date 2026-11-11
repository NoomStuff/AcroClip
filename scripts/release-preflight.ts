import { readFile } from "node:fs/promises";
import { mediaArchives } from "./media-lock";
import { publishedDownloads } from "./release-downloads";
import { targets } from "./ci-candidate";

// Cheap input checks run before downloads and packaging. Publication repeats
// remote identity checks because main and release state can change meanwhile.
const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string; build: { publish: { owner: string; repo: string }[] } };
const downloads = publishedDownloads(pkg.version).map((file) => file.name);
if (new Set(downloads).size !== downloads.length) throw new Error("Release downloads must have distinct names.");
if (pkg.build.publish.length !== 1 || pkg.build.publish[0]?.owner !== "NoomStuff" || pkg.build.publish[0]?.repo !== "AcroClip")
   throw new Error("Unexpected release destination.");
for (const target of targets) {
   const platform = target.replace("win-", "win32-").replace("mac-", "darwin-");
   const archives = mediaArchives[platform];
   if (!archives?.length) throw new Error(`Missing pinned source inputs: ${target}`);
   for (const archive of archives) {
      if (!archive.url.startsWith("https://") || !/^[a-f0-9]{64}$/.test(archive.sha256)) throw new Error(`Unpinned media input: ${target}`);
   }
}
console.log(`Release preflight passed for ${pkg.version} and ${targets.length} targets.`);
