import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appDownloadNames, prepareDownloads } from "./release-downloads";
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

it("publishes only the eight AttaCut app download variants, excluding source ZIPs and build reports", async () => {
   const root = await fixture();
   const names = appDownloadNames("0.3.0", ["arm64", "x64"], ["arm64", "x64"]);
   expect(names).toHaveLength(8);
   for (const name of [
      ...names,
      "AcroClip-0.3.0-darwin-arm64-sources-560fc92a.zip",
      "latest.yml",
      "AcroClip-0.3.0-win-x64-Installer.exe.blockmap",
      "AcroClip-0.3.0-windows-x64-release.json",
   ])
      await writeFile(path.join(root, name), name);
   const output = path.join(root, "downloads");
   await prepareDownloads(root, output, names);
   expect((await readdir(output)).sort()).toEqual(names.sort());
});

it("refuses an incomplete download set before copying anything", async () => {
   const root = await fixture();
   const names = appDownloadNames("0.3.0", ["x64"], ["arm64"]);
   await writeFile(path.join(root, names[0]!), "installer");
   await expect(prepareDownloads(root, path.join(root, "downloads"), names)).rejects.toThrow("Missing app download");
   expect(await readdir(root)).toEqual([names[0]]);
});

it("writes branch-hosted update feeds pointing at verified public app downloads and rejects changed bytes", async () => {
   const root = await fixture();
   const name = "AcroClip-0.3.0-win-x64-Installer.exe";
   const bytes = Buffer.from("installer fixture");
   const sha512 = createHash("sha512").update(bytes).digest("base64");
   await writeFile(path.join(root, name), bytes);
   await writeFile(
      path.join(root, "latest.yml"),
      `version: 0.3.0\npath: ${name}\nsha512: ${sha512}\nfiles:\n  - url: ${name}\n    size: ${bytes.length}\n    sha512: ${sha512}\n`
   );
   const output = path.join(root, "feed");
   await prepareUpdateFeed(root, output, "v0.3.0", "latest.yml");
   const feed = await readFile(path.join(output, "latest.yml"), "utf8");
   expect(feed.match(/https:\/\/github.com\/NoomStuff\/AcroClip\/releases\/download\/v0.3.0\/AcroClip-0.3.0-win-x64-Installer.exe/g)).toHaveLength(2);
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
      `version: 0.3.0\npath: ${name}\nsha512: ${sha512}\nfiles:\n  - url: ${name}\n    size: ${bytes.length}\n    sha512: ${sha512}\n`
   );
   await expect(prepareUpdateFeed(root, path.join(root, "feed"), "v0.3.0", "latest-linux.yml")).rejects.toThrow("does not name");
});
