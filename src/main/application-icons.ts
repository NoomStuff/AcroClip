import { createHash } from "node:crypto";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import type { ApplicationArtwork } from "../shared/types";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, file: string) => {
   const value = relative(resolve(root), resolve(file));
   return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
};
function validPng(bytes: Buffer): boolean {
   return (
      bytes.length >= 33 &&
      bytes.length <= 32768 &&
      bytes.subarray(0, 8).equals(pngSignature) &&
      bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(16) <= 64 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes.readUInt32BE(20) <= 64
   );
}
export interface StoredApplicationArtwork {
   id: string;
   iconFile?: string | undefined;
}
export async function storeApplicationArtwork(root: string, art: ApplicationArtwork): Promise<StoredApplicationArtwork | undefined> {
   if (!/^[a-f0-9]{64}$/.test(art.id)) return undefined;
   const stored: StoredApplicationArtwork = { id: art.id };
   const match = /^data:image\/png;base64,([a-z0-9+/]+={0,2})$/i.exec(art.icon);
   if (!match || art.icon.length > 45000) return stored;
   const bytes = Buffer.from(match[1]!, "base64");
   if (!validPng(bytes)) return stored;
   const canonicalRoot = await realpath(root);
   const metadataDirectory = join(root, ".acroclip");
   await mkdir(metadataDirectory, { recursive: true });
   if (!inside(canonicalRoot, await realpath(metadataDirectory))) return stored;
   const directory = join(metadataDirectory, "app-icons");
   await mkdir(directory, { recursive: true });
   if (!inside(canonicalRoot, await realpath(directory))) return stored;
   const name = `${hash(bytes)}.png`,
      file = join(directory, name);
   const entries = await readdir(directory);
   if (!entries.includes(name) && entries.length >= 512) return stored;
   try {
      const handle = await open(file, "wx");
      try {
         await handle.writeFile(bytes);
      } finally {
         await handle.close();
      }
   } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
   }
   return { ...stored, iconFile: `.acroclip/app-icons/${name}` };
}
export async function readApplicationArtwork(root: string, stored: StoredApplicationArtwork): Promise<string | undefined> {
   if (!stored.iconFile || !/^\.acroclip\/app-icons\/[a-f0-9]{64}\.png$/.test(stored.iconFile)) return undefined;
   try {
      const file = await realpath(join(root, stored.iconFile));
      if (!inside(await realpath(root), file)) return undefined;
      const handle = await open(file, "r");
      let bytes: Buffer;
      try {
         const buffer = Buffer.alloc(32769);
         const result = await handle.read(buffer, 0, buffer.length, 0);
         bytes = buffer.subarray(0, result.bytesRead);
      } finally {
         await handle.close();
      }
      if (!validPng(bytes) || !stored.iconFile.endsWith(`${hash(bytes)}.png`)) return undefined;
      return `data:image/png;base64,${bytes.toString("base64")}`;
   } catch {
      return undefined;
   }
}
