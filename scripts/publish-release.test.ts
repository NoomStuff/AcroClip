import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

interface Asset {
   id?: number;
   name: string;
   size: number;
   digest: string;
   state: string;
   browser_download_url?: string;
}
interface Release {
   id: number;
   draft: boolean;
   prerelease: boolean;
   body: string;
   tag_name: string;
   target_commitish: string;
   html_url: string;
}
const publish = createRequire(import.meta.url)("./publish-release.cjs") as (args: {
   github: unknown;
   context: unknown;
   core: unknown;
   directory: string;
}) => Promise<void>;
const roots: string[] = [];
afterEach(async () => {
   vi.unstubAllEnvs();
   await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
   const directory = await mkdtemp(path.join(tmpdir(), "acroclip-publish-"));
   roots.push(directory);
   const sha = "a".repeat(40);
   const files = [];
   for (const name of ["sources/1.zip", "sources/2.zip", "sources/3.zip", "sources/4.zip", "sources/5.zip", "downloads/app.exe"]) {
      const bytes = Buffer.from(name);
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), bytes);
      files.push({ path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
   }
   await mkdir(path.join(directory, "feeds"));
   for (const name of ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"]) await writeFile(path.join(directory, "feeds", name), "verified feed");
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify({ version: "0.3.1", commit: sha, run: "123", files }));
   const releases: Release[] = [];
   let nextReleaseId = 1;
   const assets = new Map<number, Asset[]>();
   const refs = new Map<string, string>([["heads/main", sha]]);
   let provenance: string | undefined;
   const missing = () => {
      throw Object.assign(new Error("not found"), { status: 404 });
   };
   const repos = {
      getContent: vi.fn(async () => ({
         data: provenance ? { type: "file", encoding: "base64", content: Buffer.from(provenance).toString("base64") } : missing(),
      })),
      getCommit: vi.fn(async ({ ref }: { ref: string }) => ({ data: { sha: refs.get(ref.replace(/^refs\//, "")) ?? missing() } })),
      getReleaseByTag: vi.fn(async ({ tag }: { tag: string }) => ({
         data: releases.find((release) => release.tag_name === tag && !release.draft) ?? missing(),
      })),
      listReleases: vi.fn(async () => ({ data: releases })),
      createRelease: vi.fn(async (input: Omit<Release, "id" | "html_url">) => {
         const release = { ...input, id: nextReleaseId++, html_url: `https://github.com/NoomStuff/AcroClip/releases/tag/${input.tag_name}` };
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
         const release = releases.find((entry) => entry.id === release_id)!;
         assets.get(release_id)!.push({
            name,
            state: "uploaded",
            size: data.length,
            digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
            browser_download_url: `https://github.com/NoomStuff/AcroClip/releases/download/${release.tag_name}/${name}`,
         });
      }),
      updateRelease: vi.fn(async ({ release_id }: { release_id: number }) => {
         const release = releases.find((release) => release.id === release_id)!;
         release.draft = false;
         refs.set(`tags/${release.tag_name}`, release.target_commitish);
      }),
   };
   const git = {
      getRef: vi.fn(async ({ ref }: { ref: string }) => ({ data: { object: { sha: refs.get(ref) ?? missing() } } })),
      getCommit: vi.fn(async () => ({ data: { tree: { sha: "previous-tree" } } })),
      createTree: vi.fn(async (input: { base_tree?: string; tree: { path: string; content: string }[] }) => {
         provenance = input.tree.find((file) => file.path === "releases/v0.3.1.json")?.content ?? provenance;
         return { data: { sha: "tree" } };
      }),
      createCommit: vi.fn(async () => ({ data: { sha: "feed-commit" } })),
      createRef: vi.fn(async ({ ref, sha: value }: { ref: string; sha: string }) => {
         refs.set(ref.replace(/^refs\//, ""), value);
      }),
      updateRef: vi.fn(async ({ ref, sha: value }: { ref: string; sha: string }) => {
         refs.set(ref, value);
      }),
   };
   const github = {
      rest: { repos, git },
      paginate: async <T, P>(method: (params: P) => Promise<{ data: T[] }>, params: P) => (await method(params)).data,
   };
   const args = { github, context: { repo: { owner: "NoomStuff", repo: "AcroClip" }, sha, runId: 123 }, core: { info: vi.fn() }, directory };
   return { args, repos, git, releases, refs, assets, sha, directory };
}

it("automatically publishes sources before app downloads and feeds, with blank descriptions", async () => {
   const { args, repos, git, refs, sha, releases } = await fixture();
   await publish(args);
   expect(refs.get("tags/v0.3.1")).toBe(sha);
   expect(releases[0]!.tag_name).toMatch(/^v0\.3\.1-sources-[a-f0-9]{12}$/);
   expect(refs.get(`tags/${releases[0]!.tag_name}`)).toBe(sha);
   expect(refs.get("heads/updates")).toBe("feed-commit");
   expect(releases.map((release) => [release.prerelease, release.draft, release.body])).toEqual([
      [true, false, ""],
      [false, false, ""],
   ]);
   expect(repos.updateRelease.mock.invocationCallOrder.at(-1)!).toBeLessThan(git.updateRef.mock.invocationCallOrder[0]!);
   await publish(args);
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(6);
   expect(repos.updateRelease).toHaveBeenCalledTimes(2);
   const tree = git.createTree.mock.calls.find(([input]) => input.tree.some((file) => file.path === "releases/v0.3.1.json"))![0];
   expect(git.createTree.mock.calls.at(-1)![0].base_tree).toBe("previous-tree");
   const provenance = JSON.parse(tree.tree.find((file) => file.path === "releases/v0.3.1.json")!.content) as Record<string, unknown>;
   expect(provenance).toMatchObject({ commit: sha, run: "123", sourceRelease: releases[0]!.html_url });
   expect(provenance).not.toHaveProperty("attempt");
});

it("refuses a stale main commit before creating a release or feed", async () => {
   const { args, refs, repos, git } = await fixture();
   refs.set("heads/main", "b".repeat(40));
   await expect(publish(args)).rejects.toThrow("Main changed");
   expect(repos.createRelease).not.toHaveBeenCalled();
   expect(git.createTree).not.toHaveBeenCalled();
});

it.each(["sha", "runId"] as const)("rejects another workflow's %s before publication", async (field) => {
   const { args, repos, git } = await fixture();
   if (field === "sha") args.context.sha = "b".repeat(40);
   else args.context.runId = 456;
   await expect(publish(args)).rejects.toThrow("current workflow identity");
   expect(repos.createRelease).not.toHaveBeenCalled();
   expect(git.createTree).not.toHaveBeenCalled();
});

it.each([1, 2])("refuses changed public bytes in release %s without overwriting them", async (id) => {
   const { args, assets, repos, git } = await fixture();
   await publish(args);
   assets.get(id)![0]!.digest = `sha256:${"b".repeat(64)}`;
   await expect(publish(args)).rejects.toThrow("Existing release asset differs");
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(6);
   expect(git.createTree).toHaveBeenCalledTimes(2);
});

it("refuses local bytes changed between sealing and upload", async () => {
   const { args, directory, repos } = await fixture();
   await writeFile(path.join(directory, "downloads/app.exe"), "tampered");
   await expect(publish(args)).rejects.toThrow("Upload bytes changed");
   expect(repos.updateRelease).toHaveBeenCalledTimes(1);
});

it("repairs an interrupted private source upload without replacing public files", async () => {
   const { args, assets, repos } = await fixture();
   repos.uploadReleaseAsset.mockImplementationOnce(async ({ release_id, name }) => {
      assets.get(release_id)!.push({ id: 99, name, state: "starter", size: 0, digest: "" });
      throw new Error("Upload interrupted");
   });
   await expect(publish(args)).rejects.toThrow("Upload interrupted");
   await publish(args);
   expect(repos.createRelease).toHaveBeenCalledTimes(2);
   expect(repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 99 }));
   expect(repos.updateRelease).toHaveBeenCalledTimes(2);
});

it("blocks app publication when uploaded sources are missing or changed", async () => {
   const { args, assets, repos } = await fixture();
   const updateRelease = repos.updateRelease.getMockImplementation()!;
   repos.updateRelease.mockImplementation(async (input) => {
      await updateRelease(input);
      if (input.release_id === 1) assets.get(1)!.pop();
   });
   await expect(publish(args)).rejects.toThrow("Source release must contain exactly five source packets");
   expect(repos.createRelease).toHaveBeenCalledTimes(1);
});

it("refuses changed public provenance before touching releases or feeds", async () => {
   const { args, repos, git } = await fixture();
   await publish(args);
   repos.getContent.mockResolvedValueOnce({ data: { type: "file", encoding: "base64", content: Buffer.from("another candidate").toString("base64") } });
   await expect(publish(args)).rejects.toThrow("Published release provenance differs");
   expect(repos.createRelease).toHaveBeenCalledTimes(2);
   expect(git.createTree).toHaveBeenCalledTimes(2);
});

it("replaces unpublished provenance when a corrected candidate retries the same version", async () => {
   const { args, repos, git } = await fixture();
   repos.getContent.mockResolvedValueOnce({ data: { type: "file", encoding: "base64", content: Buffer.from("failed candidate").toString("base64") } });
   await publish(args);
   expect(repos.updateRelease).toHaveBeenCalledTimes(2);
   expect(git.createTree).toHaveBeenCalledTimes(2);
});

it("publishes a corrected commit after source publication without changing the earlier public source release", async () => {
   const { args, repos, refs, releases, directory } = await fixture();
   const upload = repos.uploadReleaseAsset.getMockImplementation()!;
   let interrupted = false;
   repos.uploadReleaseAsset.mockImplementation(async (input) => {
      if (input.name === "app.exe" && !interrupted) {
         interrupted = true;
         throw new Error("App upload interrupted");
      }
      await upload(input);
   });
   await expect(publish(args)).rejects.toThrow("App upload interrupted");
   const previousSource = { ...releases[0]! };
   const sha = "b".repeat(40);
   const manifest = JSON.parse(await readFile(path.join(directory, "candidate.json"), "utf8")) as Record<string, unknown>;
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify({ ...manifest, commit: sha, run: "456" }));
   refs.set("heads/main", sha);
   args.context.sha = sha;
   args.context.runId = 456;
   await publish(args);
   expect(releases[0]).toEqual(previousSource);
   expect(refs.get(`tags/${previousSource.tag_name}`)).toBe("a".repeat(40));
   const newSource = releases.find((release) => release.prerelease && release.target_commitish === sha)!;
   expect(newSource.tag_name).not.toBe(previousSource.tag_name);
   expect(refs.get(`tags/${newSource.tag_name}`)).toBe(sha);
   expect(refs.get("tags/v0.3.1")).toBe(sha);
   expect(repos.deleteRelease).toHaveBeenCalledTimes(1);
});

it("checks missing tags through the ref API before resolving existing commits", async () => {
   const { args, repos, refs } = await fixture();
   repos.getCommit.mockImplementation(async ({ ref }) => {
      const sha = refs.get(ref.replace(/^refs\//, ""));
      if (!sha) throw Object.assign(new Error("No commit found for SHA"), { status: 422 });
      return { data: { sha } };
   });
   await publish(args);
   expect(repos.getCommit).toHaveBeenCalledTimes(2);
});

it("refuses sources marked as a stable release", async () => {
   const { args, releases, repos } = await fixture();
   await publish(args);
   releases[0]!.prerelease = false;
   await expect(publish(args)).rejects.toThrow("wrong prerelease status");
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(6);
});

it("retries a feed failure after publication using retained provenance and exact public bytes", async () => {
   const { args, repos, git } = await fixture();
   const createTree = git.createTree.getMockImplementation()!;
   let calls = 0;
   git.createTree.mockImplementation(async (input) => {
      if (++calls === 2) throw new Error("Feed write interrupted");
      return createTree(input);
   });
   await expect(publish(args)).rejects.toThrow("Feed write interrupted");
   await publish(args);
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(6);
   expect(repos.updateRelease).toHaveBeenCalledTimes(2);
});
