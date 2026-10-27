// Adapted from AttaCut's MIT-licensed feed preparation. See THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod";

const yaml = createRequire(import.meta.url)("js-yaml") as {
   load(text: string, options: { schema: unknown }): unknown;
   dump(value: unknown): string;
   JSON_SCHEMA: unknown;
};
const feedSchema = z
   .object({
      version: z.string(),
      path: z.string(),
      sha512: z.string(),
      files: z.array(z.object({ url: z.string(), sha512: z.string(), size: z.number().int().positive() })).length(1),
   })
   .passthrough();

export async function prepareUpdateFeed(directory: string, output: string, tag: string, channel: string): Promise<void> {
   if (!/^v\d+\.\d+\.\d+$/.test(tag) || !["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml", "latest-mac.yml"].includes(channel))
      throw new Error("Unexpected release tag or update channel.");
   const feed = feedSchema.parse(yaml.load(await readFile(path.join(directory, channel), "utf8"), { schema: yaml.JSON_SCHEMA }));
   const file = feed.files[0]!;
   const name = file.url;
   const expectedName = {
      "latest.yml": `AcroClip-${tag.slice(1)}-win-x64-Installer.exe`,
      "latest-linux.yml": `AcroClip-${tag.slice(1)}-linux-x86_64.AppImage`,
      "latest-linux-arm64.yml": `AcroClip-${tag.slice(1)}-linux-arm64.AppImage`,
      "latest-mac.yml": `AcroClip-${tag.slice(1)}-mac-${process.arch}.zip`,
   }[channel];
   if (feed.version !== tag.slice(1) || path.basename(name) !== name || /[\\/:]/.test(name) || name !== expectedName || feed.path !== name)
      throw new Error("Update feed does not name the release's app package.");
   const packagePath = path.join(directory, name);
   if ((await stat(packagePath)).size !== file.size) throw new Error("Update package size differs.");
   const hash = createHash("sha512");
   for await (const bytes of createReadStream(packagePath)) hash.update(bytes);
   if (hash.digest("base64") !== file.sha512 || file.sha512 !== feed.sha512) throw new Error("Update package checksum differs.");
   const url = `https://github.com/NoomStuff/AcroClip/releases/download/${tag}/${encodeURIComponent(name)}`;
   file.url = url;
   feed.path = url;
   await mkdir(output, { recursive: true });
   await writeFile(path.join(output, channel), yaml.dump(feed));
}

if (import.meta.main) {
   const [directory, output, tag, ...channels] = process.argv.slice(2);
   if (!directory || !output || !tag || !channels.length) throw new Error("Pass build directory, feed directory, tag and channel filenames.");
   for (const channel of channels) await prepareUpdateFeed(directory, output, tag, channel);
}
