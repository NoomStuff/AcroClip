/* global module */

module.exports = async function prepare({ github, context, core }) {
   const { execFileSync } = await import("node:child_process");
   const { readFileSync } = await import("node:fs");
   const inputs = context.payload.inputs ?? {};
   const candidate = inputs.verify_candidate === "true" || !!inputs.candidate_sha;
   if (inputs.candidate_sha && !/^[a-f0-9]{40}$/.test(inputs.candidate_sha)) throw Error("candidate_sha must be a complete commit SHA");
   const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
   if (commit !== (inputs.candidate_sha || context.sha)) throw Error("Checkout differs from the requested commit");
   const version = JSON.parse(readFileSync("package.json", "utf8")).version;
   if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Stable package version required");
   if (!candidate && context.ref !== "refs/heads/main") throw Error("Publication requires main");
   let existing;
   try {
      existing = (await github.rest.repos.getReleaseByTag({ ...context.repo, tag: `v${version}` })).data;
   } catch (error) {
      if (error.status !== 404) throw error;
   }
   const main = (await github.rest.git.getRef({ ...context.repo, ref: "heads/main" })).data.object.sha;
   const release = !candidate && main === commit && (!existing || existing.draft);
   if (release) {
      try {
         await github.rest.git.getRef({ ...context.repo, ref: `tags/v${version}` });
         throw Error("An unpublished release cannot reserve a version tag");
      } catch (error) {
         if (error.status !== 404) throw error;
      }
   }
   let changed;
   const before = context.payload.before;
   if (/^[a-f0-9]{40}$/.test(before ?? "") && !/^0+$/.test(before)) {
      try {
         changed = execFileSync("git", ["diff", "--name-only", before, commit, "--"], { encoding: "utf8" }).trim().split("\n");
      } catch {
         // Unknown history must run checks, never skip them.
      }
   }
   // A commit that only changes the version, on top of a commit whose full candidate
   // passed, ships after building and verifying package bytes. The parent already ran
   // every capture, media and UI suite on identical code.
   let fast = false;
   if (release) {
      const files = execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD"], { encoding: "utf8" });
      const patch = execFileSync("git", ["diff", "--unified=0", "HEAD^", "HEAD", "--", "package.json"], { encoding: "utf8" });
      if (module.exports.versionOnly(files, patch)) {
         const parent = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
         const statuses = await github.paginate(github.rest.repos.listCommitStatusesForRef, { ...context.repo, ref: parent, per_page: 100 });
         // Statuses list newest first. Only the latest candidate result counts.
         fast = statuses.find((status) => status.context === "Release candidate")?.state === "success";
         if (!fast) core.notice(`${parent.slice(0, 7)} has no passing candidate, so this release runs every suite.`);
      }
   }
   const native = (platform) =>
      !changed ||
      changed.some(
         (file) =>
            /^(src\/main\/|src\/shared\/|\.github\/|package\.json$|bun\.lock$)/.test(file) ||
            file.startsWith("scripts/") ||
            (file.startsWith("native/") && (platform === "linux" ? !file.startsWith("native/macos/") : !file.includes("linux")))
      );
   for (const [key, value] of Object.entries({
      candidate_sha: commit,
      version,
      tag: `v${version}`,
      // Every current main commit becomes a full private candidate, so releases land on proven code.
      build: candidate || main === commit,
      publish: release,
      fast,
      native_linux: native("linux"),
      native_macos: native("mac"),
   }))
      core.setOutput(key, String(value));
   await core.summary
      .addRaw(
         candidate
            ? `Private candidate ${commit}. Publication is disabled.`
            : release
              ? fast
                 ? `Version-only release of v${version} on a verified candidate. Build, verify package bytes and publish.`
                 : `Verify and publish v${version} at ${commit} with every suite.`
              : main !== commit
                ? "Superseded commit. Run app checks without packaging."
                : `Verify ${commit} as a private candidate. v${version} is already published.`
      )
      .write();
};

/** True when a commit's diff changes nothing but the package.json version line. */
module.exports.versionOnly = function versionOnly(files, patch) {
   const changed = files.trim().split("\n");
   const lines = patch.split("\n").filter((line) => /^[+-](?![+-])/.test(line));
   return changed.length === 1 && changed[0] === "package.json" && lines.length === 2 && lines.every((line) => /^[+-]\s*"version": "[^"]+",$/.test(line));
};
