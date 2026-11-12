import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

interface Asset {
   id: number;
   name: string;
   size: number;
   digest: string;
   state: string;
}
interface Release {
   id: number;
   draft: boolean;
   prerelease: boolean;
   body: string;
   name: string;
   tag_name: string;
   target_commitish: string;
}
const publish = createRequire(import.meta.url)("./publish-release.cjs") as (args: {
   github: unknown;
   context: unknown;
   core: unknown;
   directory: string;
}) => Promise<void>;
const roots: string[] = [];
afterEach(async () => {
   await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const names = [
   "sources/AcroClip-sources-windows-x64.zip",
   "sources/AcroClip-sources-linux-x64.zip",
   "sources/AcroClip-sources-linux-arm64.zip",
   "sources/AcroClip-sources-macos-x64.zip",
   "sources/AcroClip-sources-macos-arm64.zip",
   "downloads/AcroClip-windows-x64-setup.exe",
   "feeds/latest.yml",
   "feeds/latest-linux.yml",
   "feeds/latest-linux-arm64.yml",
];

async function fixture() {
   const directory = await mkdtemp(path.join(tmpdir(), "acroclip-publish-"));
   roots.push(directory);
   const sha = "a".repeat(40);
   const files = [];
   for (const name of [...names, "evidence/report.json"]) {
      const bytes = Buffer.from(name);
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), bytes);
      files.push({ path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
   }
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify({ version: "0.3.1", commit: sha, run: "123", files }));
   const releases: Release[] = [];
   let nextId = 1;
   const assets = new Map<number, Asset[]>();
   const refs = new Map<string, string>([["heads/main", sha]]);
   const missing = () => {
      throw Object.assign(new Error("not found"), { status: 404 });
   };
   const repos = {
      getCommit: vi.fn(async ({ ref }: { ref: string }) => ({ data: { sha: refs.get(ref.replace(/^refs\//, "")) ?? missing() } })),
      listReleases: vi.fn(async () => ({ data: releases })),
      createRelease: vi.fn(async (input: Omit<Release, "id">) => {
         const release = { ...input, id: nextId++ };
         releases.push(release);
         assets.set(release.id, []);
         return { data: release };
      }),
      deleteRelease: vi.fn(async ({ release_id }: { release_id: number }) => {
         releases.splice(
            releases.findIndex((release) => release.id === release_id),
            1
         );
      }),
      listReleaseAssets: vi.fn(async ({ release_id }: { release_id: number }) => ({ data: assets.get(release_id)! })),
      deleteReleaseAsset: vi.fn(async ({ asset_id }: { asset_id: number }) => {
         for (const items of assets.values()) {
            const index = items.findIndex((asset) => asset.id === asset_id);
            if (index !== -1) items.splice(index, 1);
         }
      }),
      uploadReleaseAsset: vi.fn(async ({ release_id, name, data }: { release_id: number; name: string; data: Buffer }) => {
         assets.get(release_id)!.push({
            id: nextId++,
            name,
            state: "uploaded",
            size: data.length,
            digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
         });
      }),
      updateRelease: vi.fn(async ({ release_id }: { release_id: number }) => {
         const release = releases.find((entry) => entry.id === release_id)!;
         release.draft = false;
         refs.set(`tags/${release.tag_name}`, release.target_commitish);
      }),
   };
   const git = { getRef: vi.fn(async ({ ref }: { ref: string }) => ({ data: { object: { sha: refs.get(ref) ?? missing() } } })) };
   const github = {
      rest: { repos, git },
      paginate: async <T, P>(method: (params: P) => Promise<{ data: T[] }>, params: P) => (await method(params)).data,
   };
   const args = {
      github,
      context: { repo: { owner: "NoomStuff", repo: "AcroClip" }, sha, runId: 123 },
      core: { info: vi.fn() },
      directory,
      notes: "- Fix the thing (aaaaaaa)",
   };
   return { args, repos, releases, refs, assets, sha, directory };
}

it("publishes downloads, feeds and sources as one release with no evidence files", async () => {
   const { args, repos, refs, sha, releases, assets } = await fixture();
   await publish(args);
   expect(refs.get("tags/v0.3.1")).toBe(sha);
   expect(releases).toHaveLength(1);
   expect(releases[0]).toMatchObject({ name: "AcroClip 0.3.1", prerelease: false, draft: false, target_commitish: sha });
   expect(releases[0]!.body).toBe(
      "- Fix the thing (aaaaaaa)\n\nSource code for the GPL and LGPL components bundled with AcroClip is in the AcroClip-sources files, one per platform."
   );
   expect(
      assets
         .get(1)!
         .map((asset) => asset.name)
         .sort()
   ).toEqual(names.map((name) => name.split("/").at(-1)).sort());
   expect(repos.updateRelease).toHaveBeenCalledWith(expect.objectContaining({ draft: false, make_latest: "true" }));
});

it("confirms an already public release on retry without uploading again", async () => {
   const { args, repos } = await fixture();
   await publish(args);
   await publish(args);
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(names.length);
   expect(repos.updateRelease).toHaveBeenCalledTimes(1);
});

it("refuses changed public bytes without overwriting them", async () => {
   const { args, assets, repos } = await fixture();
   await publish(args);
   assets.get(1)![0]!.digest = `sha256:${"b".repeat(64)}`;
   await expect(publish(args)).rejects.toThrow("differs from the sealed candidate");
   expect(repos.deleteReleaseAsset).not.toHaveBeenCalled();
});

it("refuses a stale main commit before creating a release", async () => {
   const { args, refs, repos } = await fixture();
   refs.set("heads/main", "b".repeat(40));
   await expect(publish(args)).rejects.toThrow("Main changed");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it.each(["sha", "runId"] as const)("rejects another workflow's %s before publication", async (field) => {
   const { args, repos } = await fixture();
   if (field === "sha") args.context.sha = "b".repeat(40);
   else args.context.runId = 456;
   await expect(publish(args)).rejects.toThrow("current workflow identity");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it("refuses local bytes changed between sealing and upload", async () => {
   const { args, directory, repos } = await fixture();
   await writeFile(path.join(directory, "downloads/AcroClip-windows-x64-setup.exe"), "tampered");
   await expect(publish(args)).rejects.toThrow("Upload bytes changed");
   expect(repos.updateRelease).not.toHaveBeenCalled();
});

it("repairs an interrupted private upload and keeps the draft private until complete", async () => {
   const { args, assets, repos, releases } = await fixture();
   const upload = repos.uploadReleaseAsset.getMockImplementation()!;
   repos.uploadReleaseAsset.mockImplementationOnce(async ({ release_id, name }) => {
      assets.get(release_id)!.push({ id: 99, name, state: "starter", size: 0, digest: "" });
      throw new Error("Upload interrupted");
   });
   await expect(publish(args)).rejects.toThrow("Upload interrupted");
   expect(releases[0]!.draft).toBe(true);
   repos.uploadReleaseAsset.mockImplementation(upload);
   await publish(args);
   expect(repos.createRelease).toHaveBeenCalledTimes(1);
   expect(repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 99 }));
   expect(releases[0]!.draft).toBe(false);
});

it("discards a stale private draft when a corrected commit retries the same version", async () => {
   const { args, repos, refs, releases, directory } = await fixture();
   const upload = repos.uploadReleaseAsset.getMockImplementation()!;
   repos.uploadReleaseAsset.mockImplementationOnce(async () => {
      throw new Error("Upload interrupted");
   });
   await expect(publish(args)).rejects.toThrow("Upload interrupted");
   repos.uploadReleaseAsset.mockImplementation(upload);
   const sha = "b".repeat(40);
   const manifest = JSON.parse(await readFile(path.join(directory, "candidate.json"), "utf8")) as Record<string, unknown>;
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify({ ...manifest, commit: sha, run: "456" }));
   refs.set("heads/main", sha);
   args.context.sha = sha;
   args.context.runId = 456;
   await publish(args);
   expect(repos.deleteRelease).toHaveBeenCalledTimes(1);
   expect(releases).toHaveLength(1);
   expect(refs.get("tags/v0.3.1")).toBe(sha);
});

it("refuses an existing tag on another commit", async () => {
   const { args, refs, repos } = await fixture();
   refs.set("tags/v0.3.1", "c".repeat(40));
   await expect(publish(args)).rejects.toThrow("points to another commit");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it("requires every source packet and feed", async () => {
   const { args, directory } = await fixture();
   const manifest = JSON.parse(await readFile(path.join(directory, "candidate.json"), "utf8")) as { files: { path: string }[] };
   manifest.files = manifest.files.filter((file) => file.path !== "sources/AcroClip-sources-linux-x64.zip");
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify(manifest));
   await expect(publish(args)).rejects.toThrow("corresponding-source packets");
});
