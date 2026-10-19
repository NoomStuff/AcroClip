import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { storeApplicationArtwork, readApplicationArtwork } from "./application-icons";
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
const id = createHash("sha256").update("verified-executable").digest("hex");
describe("portable application artwork", () => {
   it("stores and reads artwork through a collection directory alias", async () => {
      const parent = await mkdtemp(join(tmpdir(), "acroclip-icon-alias-"));
      const root = join(parent, "collection"),
         alias = join(parent, "alias");
      try {
         await mkdir(root);
         await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
         const stored = await storeApplicationArtwork(alias, { id, icon: png });
         expect(stored?.iconFile).toBeDefined();
         expect(await readApplicationArtwork(alias, stored!)).toBe(png);
      } finally {
         await rm(parent, { recursive: true, force: true });
      }
   });
   it("survives moving the collection and falls back for corrupt or outside files without deleting them", async () => {
      const parent = await mkdtemp(join(tmpdir(), "acroclip-icons-")),
         root = join(parent, "original"),
         moved = join(parent, "moved");
      await mkdir(root);
      try {
         const stored = await storeApplicationArtwork(root, { id, icon: png });
         expect(stored?.iconFile).toMatch(/^\.acroclip\/app-icons\/[a-f0-9]{64}\.png$/);
         expect(await readApplicationArtwork(root, stored!)).toBe(png);
         await rename(root, moved);
         expect(await readApplicationArtwork(moved, stored!)).toBe(png);
         await writeFile(join(moved, stored!.iconFile!), "broken image");
         expect(await readApplicationArtwork(moved, stored!)).toBeUndefined();
         expect(await readFile(join(moved, stored!.iconFile!), "utf8")).toBe("broken image");
         expect(await readApplicationArtwork(moved, { id, iconFile: "../outside.png" })).toBeUndefined();
         expect(await storeApplicationArtwork(moved, { id, icon: "data:image/svg+xml,<svg/>" })).toEqual({ id });
      } finally {
         await rm(parent, { recursive: true, force: true });
      }
   });
   it("does not write through an application-icon directory link outside the collection", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-icon-root-")),
         outside = await mkdtemp(join(tmpdir(), "acroclip-icon-outside-"));
      try {
         await mkdir(join(root, ".acroclip"));
         await symlink(outside, join(root, ".acroclip", "app-icons"), process.platform === "win32" ? "junction" : "dir");
         expect(await storeApplicationArtwork(root, { id, icon: png })).toEqual({ id });
      } finally {
         await rm(root, { recursive: true, force: true });
         await rm(outside, { recursive: true, force: true });
      }
   });
});
