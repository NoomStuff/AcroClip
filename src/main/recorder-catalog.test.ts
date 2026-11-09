import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "./recorder";

const folders: string[] = [];
afterEach(async () => {
   vi.restoreAllMocks();
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function recorder() {
   const folder = await mkdtemp(join(tmpdir(), "acroclip-recorder-catalog-"));
   folders.push(folder);
   const file = join(folder, "catalog.json");
   // No helper at this path, so the recorder is unsupported and never detects games.
   const instance = new Recorder({
      nativePath: join(folder, "missing-helper"),
      gameCatalogPath: file,
      onState: () => undefined,
      onError: () => undefined,
      onSaved: () => undefined,
   });
   return { instance, file };
}
const downloaded = [
   { id: "1", name: "Downloaded game", executables: [{ name: "downloaded.exe", os: process.platform === "linux" ? "linux" : process.platform }] },
];

it("downloads the catalogue for the Games page even when no game was ever detected", async () => {
   const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(downloaded)));
   const { instance } = await recorder();
   const catalog = await instance.gameCatalog();
   expect(fetch).toHaveBeenCalledTimes(1);
   expect(catalog.source).toBe("saved");
   expect(catalog.entries.map((entry) => entry.name)).toEqual(["Downloaded game"]);
});

it("shows a recent saved catalogue without waiting on the network", async () => {
   const fetch = vi.spyOn(globalThis, "fetch");
   const { instance, file } = await recorder();
   await writeFile(file, JSON.stringify({ updated: Date.now(), entries: downloaded }));
   expect((await instance.gameCatalog()).source).toBe("saved");
   expect(fetch).not.toHaveBeenCalled();
});

it("falls back to the built-in list when the download fails", async () => {
   vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
   const { instance } = await recorder();
   const catalog = await instance.gameCatalog();
   expect(catalog.source).toBe("built-in");
   expect(catalog.entries.length).toBeGreaterThan(5);
});
