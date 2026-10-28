import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hashFile } from "./release-sources";
import { appDownloadNames, prepareDownloads } from "./release-downloads";
import { prepareUpdateFeed } from "./prepare-update-feed";

const record = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative() });
const report = z.object({ appCommit: z.string(), source: record, asset: record.optional(), assets: z.array(record).optional() });
const macReport = z.object({
   appCommit: z.string(),
   source: z.object({
      platform: z.enum(["darwin-x64", "darwin-arm64"]),
      appCommit: z.string(),
      archive: z.object({ name: z.string(), sha256: record.shape.sha256, size: record.shape.size }),
   }),
   asset: record,
});
function platformReport(value: unknown, platform: string, version: string): z.infer<typeof report> {
   if (!platform.startsWith("darwin-")) return report.parse(value);
   const parsed = macReport.parse(value);
   if (
      parsed.source.appCommit !== parsed.appCommit ||
      parsed.source.platform !== platform ||
      !parsed.source.archive.name.startsWith(`AcroClip-${version}-${platform}-sources-`)
   )
      throw new Error("Mac source packet identity differs from its release report.");
   return {
      appCommit: parsed.appCommit,
      source: { path: parsed.source.archive.name, sha256: parsed.source.archive.sha256, size: parsed.source.archive.size },
      asset: parsed.asset,
   };
}
const manifestSchema = z.object({
   version: z.string().regex(/^\d+\.\d+\.\d+$/),
   commit: z.string().regex(/^[a-f0-9]{40}$/),
   run: z.string().regex(/^\d+$/),
   files: z.array(record),
});

async function files(root: string, prefix = ""): Promise<string[]> {
   const result: string[] = [];
   for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) result.push(...(await files(root, name)));
      else if (entry.isFile()) result.push(name);
      else throw new Error(`Unsupported candidate entry: ${name}`);
   }
   return result.sort();
}

export async function verifyCandidate(root: string): Promise<z.infer<typeof manifestSchema>> {
   const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(root, "candidate.json"), "utf8")));
   const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
   if (manifest.version !== pkg.version) throw new Error("Candidate version differs from the checked out source.");
   const actual = (await files(root)).filter((name) => name !== "candidate.json");
   if (JSON.stringify(actual) !== JSON.stringify(manifest.files.map((file) => file.path).sort())) throw new Error("Candidate file set differs.");
   for (const file of manifest.files) await check(root, file);
   const downloads = manifest.files
      .filter((file) => file.path.startsWith("downloads/"))
      .map((file) => path.posix.basename(file.path))
      .sort();
   if (JSON.stringify(downloads) !== JSON.stringify(appDownloadNames(manifest.version, ["x64", "arm64"], ["x64", "arm64"]).sort()))
      throw new Error("Candidate does not contain exactly eight app downloads.");
   return manifest;
}

async function check(root: string, file: z.infer<typeof record>): Promise<void> {
   if (file.path.includes("\\") || file.path.split("/").some((part) => part === ".." || !part) || path.isAbsolute(file.path))
      throw new Error("Unsafe candidate path.");
   const absolute = path.join(root, file.path);
   if ((await stat(absolute)).size !== file.size || (await hashFile(absolute)) !== file.sha256) throw new Error(`Candidate bytes differ: ${file.path}`);
}

export async function sealCandidate(input: string, output: string): Promise<void> {
   const version = (JSON.parse(await readFile("package.json", "utf8")) as { version: string }).version;
   const commit = process.env["CANDIDATE_SHA"] ?? process.env["GITHUB_SHA"];
   const run = process.env["GITHUB_RUN_ID"];
   if (!commit || !run) throw new Error("Candidate sealing requires exact CI identity.");
   const names = appDownloadNames(version, ["x64", "arm64"], ["x64", "arm64"]);
   const indexed = new Map<string, string>();
   for (const file of await files(input)) {
      const name = path.posix.basename(file);
      // macOS architectures use the same metadata filename. Mac updates remain manual.
      if (name === "latest-mac.yml") continue;
      if (indexed.has(name)) throw new Error(`Duplicate candidate filename: ${name}`);
      indexed.set(name, file);
   }
   const flat = path.join(output, "evidence");
   await mkdir(flat, { recursive: true });
   if ((await readdir(flat)).length) throw new Error("Candidate destination must be empty.");
   for (const [name, source] of indexed) await copyFile(path.join(input, source), path.join(flat, name));
   const covered = new Set<string>();
   const sources: string[] = [];
   for (const platform of ["windows-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
      const filename =
         platform === "windows-x64"
            ? `AcroClip-${version}-windows-x64-release.json`
            : platform.startsWith("linux")
              ? `AcroClip-${version}-linux-${platform === "linux-x64" ? "x86_64" : "arm64"}.AppImage.release.json`
              : `AcroClip-${version}-mac-${platform.slice(7)}.zip.release.json`;
      const proof = platformReport(JSON.parse(await readFile(path.join(flat, filename), "utf8")), platform, version);
      if (proof.appCommit !== commit) throw new Error(`Stale verification: ${filename}`);
      if (!new RegExp(`^AcroClip-${version.replaceAll(".", "\\.")}-${platform}-sources-${commit.slice(0, 8)}\\.zip$`).test(proof.source.path))
         throw new Error(`Wrong source packet: ${filename}`);
      await check(flat, proof.source);
      await mkdir(path.join(output, "sources"), { recursive: true });
      await copyFile(path.join(flat, proof.source.path), path.join(output, "sources", proof.source.path));
      sources.push(proof.source.path);
      for (const asset of [...(proof.assets ?? []), ...(proof.asset ? [proof.asset] : [])]) {
         await check(flat, asset);
         if (names.includes(asset.path)) covered.add(asset.path);
      }
   }
   for (const arch of ["x64", "arm64"]) {
      const name = `AcroClip-${version}-mac-${arch}.dmg`;
      const dmg = z
         .object({ source: z.string(), sourceSha256: z.string(), image: z.string(), sha256: z.string(), exactApplicationComparison: z.literal(true) })
         .parse(JSON.parse(await readFile(path.join(flat, `${name}.verification.json`), "utf8")));
      if (
         dmg.image !== name ||
         dmg.source !== `AcroClip-${version}-mac-${arch}.zip` ||
         (await hashFile(path.join(flat, name))) !== dmg.sha256 ||
         (await hashFile(path.join(flat, dmg.source))) !== dmg.sourceSha256
      )
         throw new Error("DMG does not contain the verified ZIP application.");
      covered.add(name);
   }
   if (names.some((name) => !covered.has(name))) throw new Error("App download lacks exact-byte verification.");
   await prepareDownloads(flat, path.join(output, "downloads"), names);
   for (const channel of ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"])
      await prepareUpdateFeed(flat, path.join(output, "feeds"), `v${version}`, channel);
   // Keep each large package once in the sealed artifact.
   for (const name of [...names, ...sources]) await unlink(path.join(flat, name));
   const records = await Promise.all(
      (await files(output)).map(async (file) => ({
         path: file,
         sha256: await hashFile(path.join(output, file)),
         size: (await stat(path.join(output, file))).size,
      }))
   );
   const manifest = manifestSchema.parse({ version, commit, run, files: records });
   await writeFile(path.join(output, "candidate.json"), `${JSON.stringify(manifest, null, 2)}\n`);
   await verifyCandidate(output);
}

if (import.meta.main) {
   const [input, output] = process.argv.slice(2);
   if (!input) throw new Error("Pass candidate directory, or input and empty output directories to seal.");
   if (output) await sealCandidate(input, output);
   else console.log(JSON.stringify(await verifyCandidate(input)));
}
