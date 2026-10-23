import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
   vi.stubEnv("CANDIDATE_COMMIT", sha);
   vi.stubEnv("CANDIDATE_RUN", "123");
   vi.stubEnv("CANDIDATE_ATTEMPT", "1");
   vi.stubEnv("SOURCE_REPOSITORY", "NoomStuff/AcroClip");
   vi.stubEnv("SOURCE_RELEASE_URL", "https://github.com/NoomStuff/AcroClip/releases/tag/v0.3.1-sources");
   const files = [];
   for (const name of ["sources/1.zip", "sources/2.zip", "sources/3.zip", "sources/4.zip", "sources/5.zip", "downloads/app.exe"]) {
      const bytes = Buffer.from(name);
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), bytes);
      files.push({ path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
   }
   await mkdir(path.join(directory, "feeds"));
   for (const name of ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"]) await writeFile(path.join(directory, "feeds", name), "verified feed");
   await writeFile(path.join(directory, "candidate.json"), JSON.stringify({ version: "0.3.1", commit: sha, run: "123", attempt: "1", files }));
   const releases: Release[] = [];
   const assets = new Map<number, Asset[]>();
   assets.set(
      0,
      files
         .filter((file) => file.path.startsWith("sources/"))
         .map((file) => ({
            name: file.path.slice(8),
            state: "uploaded",
            size: file.size,
            digest: `sha256:${file.sha256}`,
            browser_download_url: `https://github.com/NoomStuff/AcroClip/releases/download/v0.3.1-sources/${file.path.slice(8)}`,
         }))
   );
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
      getReleaseByTag: vi.fn(async ({ tag, repo }: { tag: string; repo: string }) => ({
         data:
            repo === process.env["SOURCE_REPOSITORY"]!.split("/").at(-1) && tag === process.env["SOURCE_RELEASE_URL"]!.split("/").at(-1)
               ? { id: 0, draft: false, prerelease: true, html_url: process.env["SOURCE_RELEASE_URL"] }
               : (releases.find((release) => release.tag_name === tag) ?? missing()),
      })),
      createRelease: vi.fn(async (input: Omit<Release, "id">) => {
         const release = { ...input, id: releases.length + 1 };
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
         assets.get(release_id)!.push({ name, state: "uploaded", size: data.length, digest: `sha256:${createHash("sha256").update(data).digest("hex")}` });
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
      rest: { repos, git, actions: { getWorkflowRun: vi.fn(async () => ({ data: { conclusion: "success", run_attempt: 1, head_sha: sha } })) } },
      paginate: async (method: typeof repos.listReleaseAssets, args: { release_id: number }) => (await method(args)).data,
   };
   const args = { github, context: { repo: { owner: "NoomStuff", repo: "AcroClip" } }, core: { info: vi.fn() }, directory };
   return { args, repos, git, releases, refs, assets, sha, directory };
}

it("publishes exact bytes and tags before feeds, and retries without replacing public assets", async () => {
   const { args, repos, git, refs, sha, releases } = await fixture();
   await publish(args);
   expect(refs.get("tags/v0.3.1")).toBe(sha);
   expect(refs.get("heads/updates")).toBe("feed-commit");
   expect(repos.updateRelease.mock.invocationCallOrder.at(-1)!).toBeLessThan(git.updateRef.mock.invocationCallOrder[0]!);
   await publish(args);
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(1);
   expect(repos.updateRelease).toHaveBeenCalledTimes(1);
   expect(releases[0]!.body).toContain("Fixes Windows installer upgrades");
   expect(releases[0]!.body).not.toMatch(/Candidate|attempt|run 123/);
   expect(releases[0]!.body).toContain("[Corresponding sources]");
   const tree = git.createTree.mock.calls.find(([input]) => input.tree.some((file) => file.path === "releases/v0.3.1.json"))![0] as {
      base_tree: string;
      tree: { path: string; content: string }[];
   };
   expect(git.createTree.mock.calls.at(-1)![0].base_tree).toBe("previous-tree");
   const provenance = JSON.parse(tree.tree.find((file) => file.path === "releases/v0.3.1.json")!.content) as { commit: string; run: string; attempt: string };
   expect(provenance).toMatchObject({ commit: sha, run: "123", attempt: "1" });
});

it("refuses a stale main commit before creating a release or feed", async () => {
   const { args, refs, repos, git } = await fixture();
   refs.set("heads/main", "b".repeat(40));
   await expect(publish(args)).rejects.toThrow("Main changed");
   expect(repos.createRelease).not.toHaveBeenCalled();
   expect(git.createTree).not.toHaveBeenCalled();
});

it("refuses different public asset bytes without overwriting them", async () => {
   const { args, assets, repos, git } = await fixture();
   await publish(args);
   assets.get(1)![0]!.digest = `sha256:${"b".repeat(64)}`;
   await expect(publish(args)).rejects.toThrow("Existing release asset differs");
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(1);
   expect(git.createTree).toHaveBeenCalledTimes(2);
});

it("refuses local bytes changed between sealing and upload", async () => {
   const { args, directory, repos } = await fixture();
   await writeFile(path.join(directory, "downloads/app.exe"), "tampered");
   await expect(publish(args)).rejects.toThrow("Upload bytes changed");
   expect(repos.updateRelease).not.toHaveBeenCalled();
});

it("repairs an interrupted private upload without consuming another version or replacing public files", async () => {
   const { args, assets, repos } = await fixture();
   repos.uploadReleaseAsset.mockImplementationOnce(async ({ release_id, name }) => {
      assets.get(release_id)!.push({ id: 99, name, state: "starter", size: 0, digest: "" });
      throw new Error("Upload interrupted");
   });
   await expect(publish(args)).rejects.toThrow("Upload interrupted");
   await publish(args);
   expect(repos.createRelease).toHaveBeenCalledTimes(1);
   expect(repos.deleteReleaseAsset).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 99 }));
   expect(repos.updateRelease).toHaveBeenCalledTimes(1);
});

it("refuses missing or changed separately hosted source packets before app publication", async () => {
   const { args, assets, repos } = await fixture();
   assets.get(0)!.pop();
   await expect(publish(args)).rejects.toThrow("Source release must contain exactly five source packets");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it("refuses placing corresponding sources in the app download release", async () => {
   const { args, repos } = await fixture();
   vi.stubEnv("SOURCE_RELEASE_URL", "https://github.com/NoomStuff/AcroClip/releases/tag/v0.3.1");
   await expect(publish(args)).rejects.toThrow("Corresponding sources require a source-only release");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it("refuses changed published provenance before touching releases or feeds", async () => {
   const { args, repos, git } = await fixture();
   repos.getContent.mockResolvedValueOnce({ data: { type: "file", encoding: "base64", content: Buffer.from("another candidate").toString("base64") } });
   await expect(publish(args)).rejects.toThrow("Published release provenance differs");
   expect(repos.createRelease).not.toHaveBeenCalled();
   expect(git.createTree).not.toHaveBeenCalled();
});

it("checks a missing tag through the ref API before resolving an existing commit", async () => {
   const { args, repos, refs } = await fixture();
   repos.getCommit.mockImplementation(async ({ ref }) => {
      const sha = refs.get(ref.replace(/^refs\//, ""));
      if (!sha) throw Object.assign(new Error("No commit found for SHA"), { status: 422 });
      return { data: { sha } };
   });
   await publish(args);
   expect(repos.getCommit).toHaveBeenCalledTimes(1);
});

it("refuses a stable source-only release in the app repository", async () => {
   const { args, repos } = await fixture();
   const getRelease = repos.getReleaseByTag.getMockImplementation()!;
   repos.getReleaseByTag.mockImplementation(async (input) => {
      const result = await getRelease(input);
      if (result.data.id === 0) result.data.prerelease = false;
      return result;
   });
   await expect(publish(args)).rejects.toThrow("source release must be a prerelease");
   expect(repos.createRelease).not.toHaveBeenCalled();
});

it("retains support for separately hosted historical source packets", async () => {
   const { args, assets } = await fixture();
   vi.stubEnv("SOURCE_REPOSITORY", "NoomStuff/AcroClip-sources");
   vi.stubEnv("SOURCE_RELEASE_URL", "https://github.com/NoomStuff/AcroClip-sources/releases/tag/v0.3.1");
   for (const asset of assets.get(0)!) asset.browser_download_url = `https://github.com/NoomStuff/AcroClip-sources/releases/download/v0.3.1/${asset.name}`;
   await publish(args);
});

it("retries a feed failure after public publication using the retained provenance", async () => {
   const { args, repos, git } = await fixture();
   const createTree = git.createTree.getMockImplementation()!;
   let calls = 0;
   git.createTree.mockImplementation(async (input) => {
      if (++calls === 2) throw new Error("Feed write interrupted");
      return createTree(input);
   });
   await expect(publish(args)).rejects.toThrow("Feed write interrupted");
   await publish(args);
   expect(repos.uploadReleaseAsset).toHaveBeenCalledTimes(1);
   expect(repos.updateRelease).toHaveBeenCalledTimes(1);
});
