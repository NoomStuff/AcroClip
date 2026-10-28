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
      build: candidate || release,
      publish: release,
      native_linux: native("linux"),
      native_macos: native("mac"),
   }))
      core.setOutput(key, String(value));
   await core.summary
      .addRaw(
         candidate
            ? `Private candidate ${commit}. Publication is disabled.`
            : release
              ? `Verify and publish v${version} at ${commit}.`
              : main !== commit
                ? "Superseded commit. Run app checks without publication."
                : `v${version} is already published. Run app checks without packaging.`
      )
      .write();
};
