/* global module, Buffer */
// Publication consumes the sealed artifact. It never packages application code.

module.exports = async function publish({ github, context, core, directory = "candidate" }) {
   const fs = await import("node:fs/promises");
   const crypto = await import("node:crypto");
   const repo = context.repo;
   const manifest = JSON.parse(await fs.readFile(`${directory}/candidate.json`, "utf8"));
   if (manifest.commit !== context.sha || manifest.run !== String(context.runId)) throw Error("Sealed artifact differs from the current workflow identity");
   const assertCurrent = async () => {
      const main = (await github.rest.git.getRef({ ...repo, ref: "heads/main" })).data.object.sha;
      if (main !== manifest.commit) throw Error("Main changed. Verify the new candidate before publication");
   };
   const tag = `v${manifest.version}`;
   async function optional(operation) {
      try {
         return await operation();
      } catch (error) {
         if (error.status === 404) return null;
         throw error;
      }
   }
   async function findRelease(releaseTag) {
      // The tag endpoint can omit drafts. Listing also finds interrupted uploads.
      const releases = await github.paginate(github.rest.repos.listReleases, repo);
      const matches = releases.filter((release) => release.tag_name === releaseTag);
      if (matches.length > 1) throw Error(`Multiple releases use ${releaseTag}`);
      return matches[0] ?? null;
   }
   async function publishAssets(releaseTag, files, body, prerelease) {
      await assertCurrent();
      const ref = await optional(() => github.rest.git.getRef({ ...repo, ref: `tags/${releaseTag}` }));
      if (ref && (await github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${releaseTag}` })).data.sha !== manifest.commit)
         throw Error(`Immutable tag ${releaseTag} points to another commit`);
      let release = await findRelease(releaseTag);
      if (release?.draft && (release.body !== body || release.target_commitish !== manifest.commit)) {
         // Only private drafts may be discarded. Never replace a public asset or tag.
         await github.rest.repos.deleteRelease({ ...repo, release_id: release.id });
         release = null;
      }
      if (!release)
         release = (
            await github.rest.repos.createRelease({
               ...repo,
               tag_name: releaseTag,
               target_commitish: manifest.commit,
               name: prerelease ? `AcroClip ${manifest.version} corresponding sources` : `AcroClip ${manifest.version}`,
               body,
               draft: true,
               prerelease,
               make_latest: "false",
            })
         ).data;
      if (release.body !== body) throw Error(`Public release ${releaseTag} has another candidate identity`);
      if (release.prerelease !== prerelease) throw Error(`Release ${releaseTag} has the wrong prerelease status`);
      if (!release.draft && !recordedProvenance) throw Error("Public release provenance is missing");
      const expected = new Map(files.map((file) => [file.path.split("/").at(-1), file]));
      const existing = await github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: release.id });
      const verifiedExisting = new Set();
      for (const asset of existing) {
         const file = expected.get(asset.name);
         if (!file || asset.state !== "uploaded" || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`) {
            if (!release.draft) throw Error(`Existing release asset differs: ${asset.name}`);
            await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
            continue;
         }
         verifiedExisting.add(asset.name);
      }
      for (const [name, file] of expected) {
         if (verifiedExisting.has(name)) continue;
         if (!release.draft) throw Error("Public release assets cannot be added or replaced");
         const bytes = await fs.readFile(`${directory}/${file.path}`);
         if (bytes.length !== file.size || crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw Error("Upload bytes changed");
         await github.rest.repos.uploadReleaseAsset({ ...repo, release_id: release.id, name, data: bytes });
      }
      const uploaded = await github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: release.id });
      if (
         uploaded.length !== files.length ||
         uploaded.some((asset) => {
            const file = expected.get(asset.name);
            return !file || asset.state !== "uploaded" || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}`;
         })
      )
         throw Error("Remote release bytes differ from the sealed candidate");
      await assertCurrent();
      if (!prerelease) await verifySources();
      if (release.draft) await github.rest.repos.updateRelease({ ...repo, release_id: release.id, draft: false, make_latest: prerelease ? "false" : "true" });
      const finalCommit = (await github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${releaseTag}` })).data.sha;
      if (finalCommit !== manifest.commit) throw Error("Published tag differs from verified commit");
   }
   const sourceRepository = `${repo.owner}/${repo.repo}`;
   const sources = manifest.files.filter((file) => file.path.startsWith("sources/"));
   if (sources.length !== 5) throw Error("All five corresponding-source packets are required");
   // Rebuilt source packets can differ at the same commit. Bind their immutable
   // tag to their bytes so interrupted publications can retry without a bump.
   const sourceKey = crypto.createHash("sha256").update(manifest.commit).update(JSON.stringify(sources)).digest("hex").slice(0, 12);
   const sourceTag = `${tag}-sources-${sourceKey}`;
   const sourceUrl = `https://github.com/${sourceRepository}/releases/tag/${sourceTag}`;
   const provenancePath = `releases/${tag}.json`;
   const provenance = JSON.stringify({ ...manifest, sourceRelease: sourceUrl }, null, 2) + "\n";
   let recordedProvenance = (await optional(() => github.rest.repos.getContent({ ...repo, path: provenancePath, ref: "updates" })))?.data;
   if (
      recordedProvenance &&
      (recordedProvenance.type !== "file" ||
         recordedProvenance.encoding !== "base64" ||
         Buffer.from(recordedProvenance.content, "base64").toString("utf8") !== provenance)
   ) {
      const existing = await findRelease(tag);
      if (existing && !existing.draft) throw Error("Published release provenance differs from the verified candidate");
      recordedProvenance = null;
   }
   const { owner, repo: sourceRepo } = repo;
   const verifySources = async () => {
      const sourceRelease = (await github.rest.repos.getReleaseByTag({ owner, repo: sourceRepo, tag: sourceTag })).data;
      if (sourceRelease.draft || sourceRelease.html_url !== sourceUrl) throw Error("Corresponding sources must already be publicly hosted");
      if (!sourceRelease.prerelease) throw Error("A same-repository source release must be a prerelease to preserve stable update discovery");
      const remoteSources = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo: sourceRepo, release_id: sourceRelease.id });
      if (remoteSources.length !== sources.length) throw Error("Source release must contain exactly five source packets");
      for (const file of sources) {
         const name = file.path.split("/").at(-1);
         const asset = remoteSources.find((entry) => entry.name === name);
         const url = `https://github.com/${sourceRepository}/releases/download/${sourceTag}/${name}`;
         if (!asset || asset.state !== "uploaded" || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}` || asset.browser_download_url !== url)
            throw Error(`Published corresponding-source bytes are missing or differ: ${name}`);
      }
   };
   async function updateBranch(entries, message) {
      await assertCurrent();
      const parent = (await optional(() => github.rest.git.getRef({ ...repo, ref: "heads/updates" })))?.data.object.sha;
      const baseTree = parent ? (await github.rest.git.getCommit({ ...repo, commit_sha: parent })).data.tree.sha : undefined;
      const tree = await github.rest.git.createTree({ ...repo, ...(baseTree ? { base_tree: baseTree } : {}), tree: entries });
      const commit = await github.rest.git.createCommit({ ...repo, message, tree: tree.data.sha, parents: [parent ?? manifest.commit] });
      if (parent) await github.rest.git.updateRef({ ...repo, ref: "heads/updates", sha: commit.data.sha, force: false });
      else await github.rest.git.createRef({ ...repo, ref: "refs/heads/updates", sha: commit.data.sha });
   }
   if (!recordedProvenance) {
      const existing = await findRelease(tag);
      if (existing && !existing.draft) throw Error("Public release provenance is missing");
      await updateBranch([{ path: provenancePath, mode: "100644", type: "blob", content: provenance }], `Record verified ${tag} provenance`);
      recordedProvenance = { type: "file", encoding: "base64", content: Buffer.from(provenance).toString("base64") };
   }
   await publishAssets(sourceTag, sources, "", true);
   await verifySources();
   await publishAssets(
      tag,
      manifest.files.filter((file) => file.path.startsWith("downloads/")),
      "",
      false
   );
   await updateBranch(
      await Promise.all(
         ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"].map(async (path) => ({
            path,
            mode: "100644",
            type: "blob",
            content: await fs.readFile(`${directory}/feeds/${path}`, "utf8"),
         }))
      ),
      `Update feeds for ${tag} at ${manifest.commit}`
   );
   core.info(`Published ${tag}`);
};
