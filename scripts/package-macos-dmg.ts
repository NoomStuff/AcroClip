import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareMacTrees, macTree } from "./macos-file-tree";
import { hashFile } from "./release-sources";

const [archive, expectedHash, output] = process.argv.slice(2);
const match = archive && /^AcroClip-(\d+\.\d+\.\d+)-mac-(arm64|x64)\.zip$/.exec(path.basename(archive));
if (process.platform !== "darwin" || !archive || !output || !match || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash))
   throw new Error("On macOS, pass a verified application ZIP, its SHA256 and an output directory.");
if ((await hashFile(archive)) !== expectedHash) throw new Error("Application ZIP differs from the verified release.");
const scratch = await mkdtemp(path.join(tmpdir(), "acroclip-dmg-"));
const staging = path.join(scratch, "staging");
const mount = path.join(scratch, "mounted");
await mkdir(output, { recursive: true });
const image = path.resolve(output, `AcroClip-${match[1]}-mac-${match[2]}.dmg`);
let attached = false;
try {
   execFileSync("python3", ["scripts/extract-macos-package.py", "--archive", path.resolve(archive), "--destination", staging], { stdio: "inherit" });
   const expected = await macTree(path.join(staging, "AcroClip.app"));
   await symlink("/Applications", path.join(staging, "Applications"));
   execFileSync("hdiutil", ["create", "-volname", "AcroClip", "-srcfolder", staging, "-fs", "HFS+", "-format", "UDZO", image], { stdio: "inherit" });
   execFileSync("hdiutil", ["verify", image], { stdio: "inherit" });
   await mkdir(mount);
   execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, image], { stdio: "inherit" });
   attached = true;
   compareMacTrees(expected, await macTree(path.join(mount, "AcroClip.app")), "DMG application matches the verified ZIP");
   if ((await hashFile(archive)) !== expectedHash) throw new Error("Application ZIP changed during packaging.");
   await writeFile(
      `${image}.verification.json`,
      JSON.stringify(
         {
            source: path.basename(archive),
            sourceSha256: expectedHash,
            image: path.basename(image),
            sha256: await hashFile(image),
            exactApplicationComparison: true,
         },
         null,
         2
      )
   );
   console.log(`Verified DMG contains the unchanged ${path.basename(archive)} application.`);
} finally {
   if (attached) execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
   await rm(scratch, { recursive: true, force: true });
}
