import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sealCandidate, verifyCandidate } from "./release-candidate";
import { appDownloadNames } from "./release-downloads";

const roots: string[] = [];
const commit = "a".repeat(40);
afterEach(async () => {
   vi.unstubAllEnvs();
   await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
   const root = await mkdtemp(path.join(tmpdir(), "acroclip-seal-"));
   roots.push(root);
   const input = path.join(root, "input");
   const output = path.join(root, "candidate");
   await mkdir(input);
   vi.stubEnv("GITHUB_SHA", commit);
   vi.stubEnv("GITHUB_RUN_ID", "123");
   vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
   const version = (JSON.parse(await readFile("package.json", "utf8")) as { version: string }).version;
   async function file(name: string, content = name) {
      const bytes = Buffer.from(content);
      await writeFile(path.join(input, name), bytes);
      return { path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
   }
   const names = appDownloadNames(version, ["x64", "arm64"], ["x64", "arm64"]);
   const assets = await Promise.all(names.map((name) => file(name)));
   for (const platform of ["windows-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
      const source = await file(`AcroClip-${version}-${platform}-sources-${commit.slice(0, 8)}.zip`);
      const covered = assets.filter((asset) =>
         platform === "windows-x64"
            ? asset.path.endsWith(".exe")
            : platform.startsWith("linux")
              ? asset.path.endsWith(`${platform === "linux-x64" ? "x86_64" : "arm64"}.AppImage`)
              : asset.path.endsWith(`mac-${platform.slice(7)}.zip`)
      );
      const name = platform === "windows-x64" ? `AcroClip-${version}-windows-x64-release.json` : `${covered[0]!.path}.release.json`;
      await file(name, JSON.stringify({ appCommit: commit, source, assets: covered }));
   }
   for (const arch of ["x64", "arm64"]) {
      const image = assets.find((asset) => asset.path.endsWith(`mac-${arch}.dmg`))!;
      const zip = assets.find((asset) => asset.path.endsWith(`mac-${arch}.zip`))!;
      await file(
         `${image.path}.verification.json`,
         JSON.stringify({ source: zip.path, sourceSha256: zip.sha256, image: image.path, sha256: image.sha256, exactApplicationComparison: true })
      );
   }
   for (const [channel, name] of [
      ["latest.yml", names[0]!],
      ["latest-linux.yml", names[2]!],
      ["latest-linux-arm64.yml", names[3]!],
   ]) {
      const bytes = await readFile(path.join(input, name!));
      const sha512 = createHash("sha512").update(bytes).digest("base64");
      await file(
         channel!,
         `version: ${version}\npath: ${name}\nsha512: ${sha512}\nfiles:\n  - url: ${name}\n    size: ${bytes.length}\n    sha512: ${sha512}\n`
      );
   }
   return { input, output, names, file };
}

it("seals exact verified packages and source packets under a commit/run/attempt identity", async () => {
   const { input, output, names } = await fixture();
   await sealCandidate(input, output);
   const sealed = await verifyCandidate(output);
   expect(sealed).toMatchObject({ commit, run: "123", attempt: "2" });
   expect(sealed.files.filter((file) => file.path.startsWith("downloads/"))).toHaveLength(8);
   expect(sealed.files.filter((file) => file.path.startsWith("sources/"))).toHaveLength(5);
   await writeFile(path.join(output, "downloads", names[0]!), "tampered");
   await expect(verifyCandidate(output)).rejects.toThrow("Candidate bytes differ");
});

it("rejects another commit's evidence even when the version is unchanged", async () => {
   const { input, output } = await fixture();
   vi.stubEnv("GITHUB_SHA", "b".repeat(40));
   await expect(sealCandidate(input, output)).rejects.toThrow("Stale verification");
});

it("rejects package bytes changed after native/source verification", async () => {
   const { input, output, names } = await fixture();
   await writeFile(path.join(input, names[0]!), "changed installer");
   await expect(sealCandidate(input, output)).rejects.toThrow("Candidate bytes differ");
});

it("rejects unknown files added to a sealed artifact", async () => {
   const { input, output } = await fixture();
   await sealCandidate(input, output);
   await writeFile(path.join(output, "downloads", "unexpected.exe"), "extra");
   await expect(verifyCandidate(output)).rejects.toThrow("Candidate file set differs");
});
