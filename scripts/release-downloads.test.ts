import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareDownloads, publishedDownloads, publishedSourceName } from "./release-downloads";
import { prepareUpdateFeed } from "./prepare-update-feed";

const folders: string[] = [];
async function fixture(): Promise<string> {
   const root = await mkdtemp(path.join(tmpdir(), "acroclip-release-layout-"));
   folders.push(root);
   return root;
}
afterEach(async () => {
   await Promise.all(folders.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("renames build outputs to versionless public downloads, leaving reports and Mac ZIPs behind", async () => {
   const root = await fixture();
   const files = publishedDownloads("0.3.0");
   for (const name of [...files.map((file) => file.source), "AcroClip-0.3.0-mac-arm64.zip", "latest.yml", "AcroClip-0.3.0-windows-x64-release.json"])
      await writeFile(path.join(root, name), name);
   const output = path.join(root, "downloads");
   await prepareDownloads(root, output, files);
   const published = (await readdir(output)).sort();
   expect(published).toEqual(files.map((file) => file.name).sort());
   expect(published.every((name) => /^AcroClip-(windows|macos|linux)-(x64|arm64)/.test(name) && !name.includes("0.3.0"))).toBe(true);
   expect(await readFile(path.join(output, "AcroClip-windows-x64-setup.exe"), "utf8")).toBe("AcroClip-0.3.0-win-x64-Installer.exe");
});

it("refuses an incomplete download set before copying anything", async () => {
   const root = await fixture();
   const files = publishedDownloads("0.3.0");
   await writeFile(path.join(root, files[0]!.source), "installer");
   await expect(prepareDownloads(root, path.join(root, "downloads"), files)).rejects.toThrow("Missing app download");
   expect(await readdir(root)).toEqual([files[0]!.source]);
});

it("names source packets by platform", () => {
   expect(publishedSourceName("darwin-arm64")).toBe("AcroClip-sources-macos-arm64.zip");
   expect(publishedSourceName("windows-x64")).toBe("AcroClip-sources-windows-x64.zip");
});

it("writes feeds that point at the tagged public download and rejects changed bytes", async () => {
   const root = await fixture();
   const name = "AcroClip-0.3.0-win-x64-Installer.exe";
   const bytes = Buffer.from("installer fixture");
   const sha512 = createHash("sha512").update(bytes).digest("base64");
   await writeFile(path.join(root, name), bytes);
   await writeFile(
      path.join(root, "latest.yml"),
      `version: 0.3.0
path: ${name}
sha512: ${sha512}
files:
  - url: ${name}
    size: ${bytes.length}
    sha512: ${sha512}
`
   );
   const output = path.join(root, "feed");
   await prepareUpdateFeed(root, output, "v0.3.0", "latest.yml");
   const feed = await readFile(path.join(output, "latest.yml"), "utf8");
   expect(feed.match(/https:\/\/github.com\/NoomStuff\/AcroClip\/releases\/download\/v0.3.0\/AcroClip-windows-x64-setup.exe/g)).toHaveLength(2);
   await writeFile(path.join(root, name), Buffer.alloc(bytes.length));
   await expect(prepareUpdateFeed(root, output, "v0.3.0", "latest.yml")).rejects.toThrow("checksum differs");
});

it("rejects a valid ARM package in the x64 update channel", async () => {
   const root = await fixture();
   const name = "AcroClip-0.3.0-linux-arm64.AppImage";
   const bytes = Buffer.from("ARM image");
   const sha512 = createHash("sha512").update(bytes).digest("base64");
   await writeFile(path.join(root, name), bytes);
   await writeFile(
      path.join(root, "latest-linux.yml"),
      `version: 0.3.0
path: ${name}
sha512: ${sha512}
files:
  - url: ${name}
    size: ${bytes.length}
    sha512: ${sha512}
`
   );
   await expect(prepareUpdateFeed(root, path.join(root, "feed"), "v0.3.0", "latest-linux.yml")).rejects.toThrow("does not name");
});
