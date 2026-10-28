import { execFileSync } from "node:child_process";
import { cp, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { candidateIdentity, manifestSchema, sha256, targets } from "./ci-candidate";
import { macTree } from "./macos-file-tree";

const record = z.object({ path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
type FileRecord = z.infer<typeof record>;
const targetSchema = z.enum(targets);
const packageFilesSchema = z.array(
   z.discriminatedUnion("kind", [
      record.extend({ kind: z.literal("file"), executable: z.boolean() }),
      z.object({ path: z.string(), kind: z.literal("link"), target: z.string() }),
   ])
);
type Target = z.infer<typeof targetSchema>;

async function inventory(root: string, prefix = ""): Promise<FileRecord[]> {
   const result: FileRecord[] = [];
   for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      const file = path.join(root, relative);
      if (entry.isDirectory()) result.push(...(await inventory(root, relative)));
      else if (entry.isFile()) result.push({ path: relative, size: (await lstat(file)).size, sha256: await sha256(file) });
      else throw new Error(`Unexpected link in release inputs: ${relative}`);
   }
   return result.sort((a, b) => a.path.localeCompare(b.path));
}

function sourcePlatform(target: Target): string {
   return target.replace("win-", "windows-").replace("mac-", "darwin-");
}

async function sourcePacket(target: Target): Promise<string> {
   const identity = await candidateIdentity(target);
   const name = `AcroClip-${identity.version}-${sourcePlatform(target)}-sources-${identity.commit.slice(0, 8)}.zip`;
   await lstat(path.join("work", name));
   return name;
}

export async function snapshot(target: Target, directory: string): Promise<void> {
   await mkdir(directory, { recursive: true });
   if ((await readdir(directory)).length) throw new Error("Snapshot directory must be empty.");
   for (const group of ["out", "resources", "build"]) await cp(group, path.join(directory, group), { recursive: true, verbatimSymlinks: true });
   await mkdir(path.join(directory, "release"));
   // The source-bound ZIP/AppImage is sufficient on Unix. Windows installer
   // verification also compares the complete unpacked payload.
   for (const entry of await readdir("release", { withFileTypes: true })) {
      if ((entry.isFile() && /^(AcroClip-|latest)/.test(entry.name)) || (target === "win-x64" && entry.name === "win-unpacked"))
         await cp(path.join("release", entry.name), path.join(directory, "release", entry.name), { recursive: true, verbatimSymlinks: true });
   }
   const source = await sourcePacket(target);
   await mkdir(path.join(directory, "work"));
   for (const name of [source, `${source}.json`]) await copyFile(path.join("work", name), path.join(directory, "work", name));
   // This inventory records the actual files tests must leave unchanged, not
   // just the transport tar. Tests consume these paths after restoration.
   const inputs = (
      await Promise.all(
         ["release", "work", "resources", "out", "build"].map(async (group) =>
            (await macTree(path.join(directory, group))).map((file) => ({ ...file, path: `${group}/${file.path}` }))
         )
      )
   ).flat();
   await mkdir(path.join(directory, ".cache"));
   await writeFile(path.join(directory, ".cache/.ci-package-files.json"), JSON.stringify(inputs, null, 2) + "\n");
}

export async function checkPackageFiles(root = "."): Promise<void> {
   const inputs = packageFilesSchema.parse(JSON.parse(await readFile(path.join(root, ".cache/.ci-package-files.json"), "utf8")));
   if (!inputs.length) throw new Error("No retained package inputs.");
   for (const input of inputs) {
      if (
         !/^(release|work|resources|out|build)\//.test(input.path) ||
         input.path.includes("\\") ||
         input.path.split("/").some((part) => part === ".." || !part)
      )
         throw new Error("Unsafe retained package path.");
   }
   for (const input of inputs) {
      const file = path.join(root, input.path);
      const info = await lstat(file);
      const groupRoot = await realpath(path.join(root, input.path.split("/")[0]!));
      if (!(await realpath(file)).startsWith(groupRoot + path.sep)) throw new Error(`Retained package path escaped: ${input.path}`);
      if (input.kind === "link") {
         if (!info.isSymbolicLink() || (await readlink(file)) !== input.target) throw new Error(`Tested package link changed: ${input.path}`);
      } else if (!info.isFile() || info.size !== input.size || !!(info.mode & 0o111) !== input.executable || (await sha256(file)) !== input.sha256)
         throw new Error(`Tested package changed: ${input.path}`);
   }
}

async function restoreSources(target: Target): Promise<void> {
   const source = path.join("work", await sourcePacket(target));
   const directory = target === "win-x64" ? "work/release-sources" : target.startsWith("mac-") ? "work/macos-release-sources" : "work/linux-release-sources";
   await mkdir(directory, { recursive: true });
   if (target === "win-x64") execFileSync("tar", ["-xf", source, "-C", directory], { stdio: "inherit" });
   else
      execFileSync(
         "python3",
         [`scripts/package-${target.startsWith("mac-") ? "macos" : "linux"}-sources.py`, "--archive", source, "--verify", "--extract", directory],
         { stdio: "inherit" }
      );
   if (target.startsWith("mac-")) {
      const { version } = await candidateIdentity(target);
      execFileSync(
         "python3",
         [
            "scripts/extract-macos-package.py",
            "--archive",
            `release/AcroClip-${version}-${target}.zip`,
            "--destination",
            `release/mac${target === "mac-arm64" ? "-arm64" : ""}`,
         ],
         { stdio: "inherit" }
      );
   }
}

export async function collectVerified(target: Target, candidate: string, output: string): Promise<void> {
   await checkPackageFiles();
   const identity = await candidateIdentity(target);
   const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(candidate, "manifest.json"), "utf8")));
   for (const key of ["commit", "version", "target", "runId", "inputsSha256"] as const)
      if (manifest[key] !== identity[key]) throw new Error("Verification receipt identity differs.");
   await mkdir(output, { recursive: true });
   if ((await readdir(output)).length) throw new Error("Verified destination must be empty.");
   const source = await sourcePacket(target);
   for (const name of [source, `${source}.json`]) await copyFile(path.join("work", name), path.join(output, name));
   for (const entry of await readdir("release", { withFileTypes: true }))
      if (entry.isFile() && /^(AcroClip-|latest)/.test(entry.name)) await copyFile(path.join("release", entry.name), path.join(output, entry.name));
   const files = await inventory(output);
   await copyFile(path.join(candidate, "manifest.json"), path.join(output, "manifest.json"));
   await writeFile(
      path.join(output, "receipt.json"),
      JSON.stringify({ ...identity, candidateSha256: await sha256(path.join(candidate, "manifest.json")), files }, null, 2) + "\n"
   );
}

export async function collectForSeal(input: string, output: string): Promise<void> {
   await mkdir(output, { recursive: true });
   if ((await readdir(output)).length) throw new Error("Seal input destination must be empty.");
   const directories = await readdir(input);
   if (directories.length !== targets.length || targets.some((target) => !directories.includes(`verified-${target}`)))
      throw new Error("Expected exactly five verified targets.");
   for (const target of targets) {
      const directory = path.join(input, `verified-${target}`);
      const expected = await candidateIdentity(target);
      const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")));
      for (const key of ["schemaVersion", "commit", "version", "target", "runId", "inputsSha256"] as const)
         if (manifest[key] !== expected[key]) throw new Error(`Stale verified target: ${target}`);
      const proof = manifestSchema
         .extend({ candidateSha256: record.shape.sha256 })
         .parse(JSON.parse(await readFile(path.join(directory, "receipt.json"), "utf8")));
      for (const key of ["commit", "version", "target", "runId", "inputsSha256"] as const)
         if (proof[key] !== expected[key]) throw new Error("Stale verification receipt.");
      if (proof.candidateSha256 !== (await sha256(path.join(directory, "manifest.json"))))
         throw new Error("Verification does not cover its candidate manifest.");
      const actual = (await readdir(directory)).filter((name) => !["manifest.json", "receipt.json"].includes(name)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(proof.files.map((file) => file.path).sort())) throw new Error("Verified file set differs.");
      const destination = path.join(output, target);
      await mkdir(destination);
      for (const file of proof.files) {
         if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.path)) throw new Error("Unsafe verified filename.");
         const absolute = path.join(directory, file.path);
         const info = await lstat(absolute);
         if (!info.isFile() || info.size !== file.size || (await sha256(absolute)) !== file.sha256) throw new Error("Verified bytes changed.");
         await copyFile(absolute, path.join(destination, file.path));
      }
   }
}

if (import.meta.main) {
   const [command, target, directory, output] = process.argv.slice(2);
   if (command === "seal" && target && directory && !output) await collectForSeal(target, directory);
   else if (command === "check" && !target) await checkPackageFiles();
   else if (command === "snapshot" && target && directory) await snapshot(targetSchema.parse(target), directory);
   else if (command === "sources" && target && !directory) await restoreSources(targetSchema.parse(target));
   else if (command === "collect" && target && directory && output) await collectVerified(targetSchema.parse(target), directory, output);
   else throw new Error("Invalid CI staging command.");
}
