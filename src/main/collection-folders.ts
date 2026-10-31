import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FolderContents } from "../shared/types";

export function folderName(name: string): string {
   const value = name.trim();
   if (
      !value ||
      value.length > 150 ||
      /[<>:"/\\|?*]/.test(value) ||
      [...value].some((character) => character.charCodeAt(0) < 32) ||
      /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ||
      value.toLowerCase() === ".acroclip"
   )
      throw new Error("Choose a valid folder name, without reserved characters or trailing dots.");
   return value;
}

export async function collectionFolder(root: string, path: string, allowRoot = true): Promise<string> {
   const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
   if (
      isAbsolute(path) ||
      parts.some((part) => part === "." || part === ".." || part.toLowerCase() === ".acroclip" || part.includes(":") || part.includes("\0")) ||
      (!allowRoot && !parts.length)
   )
      throw new Error("Choose a folder inside this collection.");
   let current = root;
   for (const part of parts) {
      current = join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Choose a real folder inside this collection.");
   }
   const actual = await realpath(current);
   const rel = relative(root, actual);
   if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("The folder points outside this collection.");
   return actual;
}

export async function folderContents(path: string, supported: ReadonlySet<string>): Promise<FolderContents> {
   let clips = 0,
      otherFiles = 0,
      folders = 0;
   const hash = createHash("sha256");
   const walk = async (directory: string): Promise<void> => {
      const info = await lstat(directory, { bigint: true });
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("The folder changed. Refresh the library and try again.");
      hash.update(JSON.stringify([relative(path, directory), String(info.dev), String(info.ino), String(info.mtimeNs)]));
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
         const full = resolve(directory, entry.name);
         if (entry.isDirectory() && !entry.isSymbolicLink()) {
            folders++;
            await walk(full);
         } else {
            const file = await lstat(full, { bigint: true });
            hash.update(
               JSON.stringify([relative(path, full), String(file.dev), String(file.ino), String(file.size), String(file.mtimeNs), String(file.ctimeNs)])
            );
            const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
            if (entry.isFile() && supported.has(extension)) clips++;
            else otherFiles++;
         }
      }
   };
   await walk(path);
   return { clips, otherFiles, folders, fingerprint: hash.digest("hex") };
}
