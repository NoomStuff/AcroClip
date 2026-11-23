/**
 * Installs the recorder from a published release into resources/recorder, so UI and capture tests
 * can run without the OBS build toolchain. Linux unpacks the AppImage. Windows unpacks the portable
 * build with 7-Zip, which opens both its NSIS wrapper and the app archive inside. The recorder
 * matches that release, not this checkout: changes under native/ still need a local build.
 *
 * bun scripts/fetch-recorder.ts [tag] [--force]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const windows = process.platform === "win32";
const target = resolve("resources/recorder");
const recorder = windows ? "acroclip-recorder.exe" : "acroclip-recorder";
// Outside resources/recorder, so a package built from it carries nothing extra.
const stamp = resolve(".cache/recorder-release/installed.txt");
/** Ties the stamp to the binary it describes, so a later local build doesn't pass for the release. */
const fingerprint = (): string => {
   const binary = statSync(join(target, recorder), { throwIfNoEntry: false });
   return binary ? `${binary.size}:${binary.mtimeMs}` : "";
};
const force = process.argv.includes("--force");
const requested = process.argv.slice(2).find((argument) => !argument.startsWith("--"));

if (process.platform !== "linux" && !windows)
   throw new Error("Only Linux and Windows releases can be unpacked here. Build the recorder with bun run build:native.");
const releasedArchitectures: Record<string, string> = windows ? { x64: "x64" } : { x64: "x64", arm64: "arm64" };
const arch = releasedArchitectures[process.arch];
if (!arch) throw new Error(`No ${windows ? "Windows" : "Linux"} release exists for ${process.arch}.`);
const asset = windows ? `AcroClip-windows-${arch}-portable.exe` : `AcroClip-linux-${arch}.AppImage`;
/** 7-Zip, or a 7-Zip compatible like NanaZip that installs the same command. */
const sevenZip = windows
   ? ["7z", "C:\\Program Files\\7-Zip\\7z.exe"].find((command) => spawnSync(command, ["i"], { stdio: "ignore" }).status === 0)
   : undefined;
if (windows && !sevenZip)
   throw new Error("Unpacking a Windows release needs 7-Zip (winget install 7zip.7zip). Or build the recorder with bun run build:native.");

const run = (command: string, args: string[], cwd?: string): string =>
   execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...(cwd ? { cwd } : {}) }).trim();
const tag = requested ?? run("gh", ["release", "view", "--json", "tagName", "--jq", ".tagName"]);

if (existsSync(target) && !force) {
   const [stampTag, stampPrint] = existsSync(stamp) ? readFileSync(stamp, "utf8").trim().split(" ") : [];
   const installed = stampTag && stampPrint === fingerprint() ? stampTag : "a local build";
   if (installed === tag) {
      console.log(`resources/recorder already holds the ${tag} recorder.`);
      process.exit(0);
   }
   throw new Error(`resources/recorder already holds ${installed}. Pass --force to replace it with ${tag}.`);
}

const cache = resolve(".cache/recorder-release", tag);
const download = join(cache, asset);
if (!existsSync(download)) {
   await mkdir(cache, { recursive: true });
   console.log(`Downloading ${tag} ${asset} (about ${windows ? 140 : 270} MB, kept in .cache/recorder-release)...`);
   const fetched = spawnSync("gh", ["release", "download", tag, "--pattern", asset, "--dir", cache], { stdio: "inherit" });
   if (fetched.status !== 0) throw new Error(`Downloading the ${tag} ${asset} failed.`);
}
const extracted = join(cache, windows ? "unpacked" : "squashfs-root");
await rm(extracted, { recursive: true, force: true });
if (windows && sevenZip) {
   const unpack = (archive: string, pattern: string) => spawnSync(sevenZip, ["x", "-y", `-o${extracted}`, archive, pattern], { stdio: "ignore" }).status === 0;
   if (!unpack(download, "$PLUGINSDIR/app-64.7z") || !unpack(join(extracted, "$PLUGINSDIR", "app-64.7z"), "resources/recorder/*"))
      throw new Error(`7-Zip couldn't unpack ${asset}.`);
} else {
   await chmod(download, 0o755);
   spawnSync(download, ["--appimage-extract", "resources/recorder/*"], { cwd: cache, stdio: "ignore" });
}
if (!existsSync(join(extracted, "resources/recorder", recorder))) throw new Error(`${asset} did not contain resources/recorder/${recorder}.`);
await rm(target, { recursive: true, force: true });
await rename(join(extracted, "resources/recorder"), target);
await rm(extracted, { recursive: true, force: true });
await writeFile(stamp, `${tag} ${fingerprint()}\n`);

console.log(`Installed the ${tag} recorder in resources/recorder.`);
const changed = spawnSync("git", ["diff", "--quiet", tag, "--", "native"]);
if (changed.status !== 0) console.warn(`native/ changed since ${tag}. Tests run against the released recorder, not those changes.`);
