/* global module */
// Publication consumes the sealed artifact. It never packages application code.
// One release carries the app downloads, updater feeds and corresponding sources.
// It stays a private draft until every byte matches, then becomes public at once.

const sourceNote = "Source code for the GPL and LGPL components bundled with AcroClip is in the AcroClip-sources files, one per platform.";

/** The included commits, then the source note. Tests pass `notes` instead of reading GitHub. */
async function releaseBody(github, repo, tag, commit, notes) {
   if (notes === undefined) {
      const { pathToFileURL } = await import("node:url");
      const { join } = await import("node:path");
      // module.path is this script's folder; the github-script runner loads it with require.
      const { releaseNotes } = await import(pathToFileURL(join(module.path, "release-notes.mjs")).href);
      notes = await releaseNotes({ tag, commit, api: async (path) => (await github.request(`GET /repos/${repo.owner}/${repo.repo}/${path}`)).data });
   }
   return [notes, sourceNote].filter(Boolean).join("\n\n");
}

module.exports = async function publish({ github, context, core, directory = "candidate", notes }) {
   const fs = await import("node:fs/promises");
   const crypto = await import("node:crypto");
   const repo = context.repo;
   const manifest = JSON.parse(await fs.readFile(`${directory}/candidate.json`, "utf8"));
   if (manifest.commit !== context.sha || manifest.run !== String(context.runId)) throw Error("Sealed artifact differs from the current workflow identity");
   const tag = `v${manifest.version}`;
   const files = manifest.files.filter((file) => /^(downloads|feeds|sources)\//.test(file.path));
   if (files.filter((file) => file.path.startsWith("sources/")).length !== 5) throw Error("All five corresponding-source packets are required");
   if (files.filter((file) => file.path.startsWith("feeds/")).length !== 3) throw Error("All three updater feeds are required");
   const expected = new Map(files.map((file) => [file.path.split("/").at(-1), file]));
   if (expected.size !== files.length) throw Error("Release asset names must be unique");

   const assertCurrent = async () => {
      const main = (await github.rest.git.getRef({ ...repo, ref: "heads/main" })).data.object.sha;
      if (main !== manifest.commit) throw Error("Main changed. Verify the new candidate before publication");
   };
   async function optional(operation) {
      try {
         return await operation();
      } catch (error) {
         if (error.status === 404) return null;
         throw error;
      }
   }
   const matches = (asset) => {
      const file = expected.get(asset.name);
      return !!file && asset.state === "uploaded" && asset.size === file.size && asset.digest === `sha256:${file.sha256}`;
   };
   const assets = (release) => github.paginate(github.rest.repos.listReleaseAssets, { ...repo, release_id: release.id });

   await assertCurrent();
   const ref = await optional(() => github.rest.git.getRef({ ...repo, ref: `tags/${tag}` }));
   if (ref && (await github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${tag}` })).data.sha !== manifest.commit)
      throw Error(`Immutable tag ${tag} points to another commit`);
   // The tag endpoint can omit drafts. Listing also finds interrupted uploads.
   const releases = (await github.paginate(github.rest.repos.listReleases, repo)).filter((release) => release.tag_name === tag);
   const published = releases.filter((release) => !release.draft);
   if (published.length > 1) throw Error(`Multiple public releases use ${tag}`);
   if (published[0]) {
      // A retry after publication only confirms the public bytes. It never changes them.
      const remote = await assets(published[0]);
      if (remote.length !== files.length || !remote.every(matches)) throw Error(`Public release ${tag} differs from the sealed candidate`);
      core.info(`${tag} is already public with the sealed bytes`);
      return;
   }
   let release = null;
   for (const draft of releases) {
      // Only private drafts may be discarded. A draft for another commit is stale.
      if (!release && draft.target_commitish === manifest.commit) release = draft;
      else await github.rest.repos.deleteRelease({ ...repo, release_id: draft.id });
   }
   release ??= (
      await github.rest.repos.createRelease({
         ...repo,
         tag_name: tag,
         target_commitish: manifest.commit,
         name: `AcroClip ${manifest.version}`,
         body: await releaseBody(github, repo, tag, manifest.commit, notes),
         draft: true,
         prerelease: false,
         make_latest: "false",
      })
   ).data;
   const present = new Set();
   for (const asset of await assets(release)) {
      if (matches(asset) && !present.has(asset.name)) present.add(asset.name);
      else await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
   }
   for (const [name, file] of expected) {
      if (present.has(name)) continue;
      const bytes = await fs.readFile(`${directory}/${file.path}`);
      if (bytes.length !== file.size || crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw Error("Upload bytes changed");
      await github.rest.repos.uploadReleaseAsset({ ...repo, release_id: release.id, name, data: bytes });
   }
   const uploaded = await assets(release);
   if (uploaded.length !== files.length || !uploaded.every(matches)) throw Error("Remote release bytes differ from the sealed candidate");
   await assertCurrent();
   // Publishing creates the tag at the draft's verified commit and makes the feeds live.
   await github.rest.repos.updateRelease({ ...repo, release_id: release.id, draft: false, make_latest: "true" });
   const finalCommit = (await github.rest.repos.getCommit({ ...repo, ref: `refs/tags/${tag}` })).data.sha;
   if (finalCommit !== manifest.commit) throw Error("Published tag differs from verified commit");
   core.info(`Published ${tag}`);
};
