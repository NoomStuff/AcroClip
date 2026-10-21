/* global module, process */
// Publication consumes the sealed artifact. It never packages application code.

module.exports = async function publish({ github, context, core, directory = "candidate" }) {
   const fs = await import("node:fs/promises");
   const crypto = await import("node:crypto");
   const repo = context.repo;
   const manifest = JSON.parse(await fs.readFile(`${directory}/candidate.json`, "utf8"));
   if (manifest.commit !== process.env.CANDIDATE_COMMIT || manifest.run !== process.env.CANDIDATE_RUN || manifest.attempt !== process.env.CANDIDATE_ATTEMPT)
      throw Error("Sealed artifact differs from the reviewed candidate identity");
   const assertCurrent = async () => {
      const main = (await github.rest.git.getRef({ ...repo, ref: "heads/main" })).data.object.sha;
      if (main !== manifest.commit) throw Error("Main changed. Verify and review the new candidate before publication");
      const run = (await github.rest.actions.getWorkflowRun({ ...repo, run_id: Number(manifest.run) })).data;
      if (run.conclusion !== "success" || run.run_attempt !== Number(manifest.attempt) || run.head_sha !== manifest.commit)
         throw Error("Candidate verification was superseded");
   };
   const tag = `v${manifest.version}`;
   const marker = `Candidate ${manifest.commit}, run ${manifest.run}, attempt ${manifest.attempt}.`;
   async function optional(operation) {
      try {
         return await operation();
      } catch (error) {
         if (error.status === 404) return null;
         throw error;
      }
   }
   async function publishAssets(releaseTag, files, body, prerelease) {
      await assertCurrent();
      const ref = await optional(() => github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${releaseTag}` }));
      if (ref && ref.data.sha !== manifest.commit) throw Error(`Immutable tag ${releaseTag} points to another commit`);
      let release = (await optional(() => github.rest.repos.getReleaseByTag({ ...repo, tag: releaseTag })))?.data;
      if (release?.draft && release.body !== body) {
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
      await verifySources();
      if (release.draft) await github.rest.repos.updateRelease({ ...repo, release_id: release.id, draft: false, make_latest: prerelease ? "false" : "true" });
      const finalCommit = (await github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${releaseTag}` })).data.sha;
      if (finalCommit !== manifest.commit) throw Error("Published tag differs from verified commit");
   }
   const sourceRepository = process.env.SOURCE_REPOSITORY;
   const sourceUrl = process.env.SOURCE_RELEASE_URL;
   if (
      !sourceRepository ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sourceRepository) ||
      sourceRepository.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase()
   )
      throw Error("Configure a separate corresponding-source repository");
   const sourcePrefix = `https://github.com/${sourceRepository}/releases/tag/`;
   const sourceTag = sourceUrl?.startsWith(sourcePrefix) ? sourceUrl.slice(sourcePrefix.length) : "";
   if (!sourceTag || !/^[A-Za-z0-9_.-]+$/.test(sourceTag)) throw Error("Pass the immutable source release URL in the configured separate repository");
   const [owner, sourceRepo] = sourceRepository.split("/");
   const sources = manifest.files.filter((file) => file.path.startsWith("sources/"));
   if (sources.length !== 5) throw Error("All five corresponding-source packets are required");
   const verifySources = async () => {
      const sourceRelease = (await github.rest.repos.getReleaseByTag({ owner, repo: sourceRepo, tag: sourceTag })).data;
      if (sourceRelease.draft || sourceRelease.html_url !== sourceUrl) throw Error("Corresponding sources must already be publicly hosted");
      const remoteSources = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo: sourceRepo, release_id: sourceRelease.id });
      for (const file of sources) {
         const name = file.path.split("/").at(-1);
         const asset = remoteSources.find((entry) => entry.name === name);
         const url = `https://github.com/${sourceRepository}/releases/download/${sourceTag}/${name}`;
         if (!asset || asset.state !== "uploaded" || asset.size !== file.size || asset.digest !== `sha256:${file.sha256}` || asset.browser_download_url !== url)
            throw Error(`Published corresponding-source bytes are missing or differ: ${name}`);
      }
   };
   await verifySources();
   await publishAssets(
      tag,
      manifest.files.filter((file) => file.path.startsWith("downloads/")),
      `${marker}\n\n[Corresponding sources](${sourceUrl})`,
      false
   );
   await assertCurrent();
   const branch = "updates";
   const parent = (await optional(() => github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })))?.data.object.sha;
   const tree = await github.rest.git.createTree({
      ...repo,
      tree: await Promise.all(
         ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"].map(async (path) => ({
            path,
            mode: "100644",
            type: "blob",
            content: await fs.readFile(`${directory}/feeds/${path}`, "utf8"),
         }))
      ),
   });
   const commit = await github.rest.git.createCommit({
      ...repo,
      message: `Update feeds for ${tag} at ${manifest.commit}`,
      tree: tree.data.sha,
      parents: [parent ?? manifest.commit],
   });
   if (parent) await github.rest.git.updateRef({ ...repo, ref: `heads/${branch}`, sha: commit.data.sha, force: false });
   else await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
   core.info(`Published ${tag} from reviewed run ${manifest.run}, attempt ${manifest.attempt}`);
};
