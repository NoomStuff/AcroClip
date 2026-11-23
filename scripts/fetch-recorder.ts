/**
 * Installs the recorder from a published Linux release into resources/recorder, so UI and capture
 * tests can run without the OBS build toolchain. The recorder matches that release, not this
 * checkout: changes under native/ still need `bun scripts/build-native-linux.ts`.
 *
 * bun scripts/fetch-recorder.ts [tag] [--force]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const target = resolve("resources/recorder");
// Outside resources/recorder, so a package built from it carries nothing extra.
const stamp = resolve(".cache/recorder-release/installed.txt");
/** Ties the stamp to the binary it describes, so a later local build doesn't pass for the release. */
const fingerprint = (): string => {
   const binary = statSync(join(target, "acroclip-recorder"), { throwIfNoEntry: false });
   return binary ? `${binary.size}:${binary.mtimeMs}` : "";
};
const force = process.argv.includes("--force");
const requested = process.argv.slice(2).find((argument) => !argument.startsWith("--"));

if (process.platform !== "linux") throw new Error("Only Linux releases can be unpacked here. Build the recorder with bun run build:native.");
const arch = { x64: "x64", arm64: "arm64" }[process.arch as string];
if (!arch) throw new Error(`No Linux release exists for ${process.arch}.`);

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
const image = join(cache, `AcroClip-linux-${arch}.AppImage`);
if (!existsSync(image)) {
   await mkdir(cache, { recursive: true });
   console.log(`Downloading ${tag} AppImage (about 270 MB, kept in .cache/recorder-release)...`);
   const download = spawnSync("gh", ["release", "download", tag, "--pattern", `AcroClip-linux-${arch}.AppImage`, "--dir", cache], { stdio: "inherit" });
   if (download.status !== 0) throw new Error(`Downloading the ${tag} AppImage failed.`);
}
await chmod(image, 0o755);
const extracted = join(cache, "squashfs-root");
await rm(extracted, { recursive: true, force: true });
const unpack = spawnSync(image, ["--appimage-extract", "resources/recorder/*"], { cwd: cache, stdio: "ignore" });
if (unpack.status !== 0 || !existsSync(join(extracted, "resources/recorder/acroclip-recorder")))
   throw new Error("The AppImage did not contain resources/recorder/acroclip-recorder.");
await rm(target, { recursive: true, force: true });
await rename(join(extracted, "resources/recorder"), target);
await rm(extracted, { recursive: true, force: true });
await writeFile(stamp, `${tag} ${fingerprint()}\n`);

console.log(`Installed the ${tag} recorder in resources/recorder.`);
const changed = spawnSync("git", ["diff", "--quiet", tag, "--", "native"]);
if (changed.status !== 0) console.warn(`native/ changed since ${tag}. Tests run against the released recorder, not those changes.`);
