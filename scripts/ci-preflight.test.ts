import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const preflight = createRequire(import.meta.url)("./ci-preflight.cjs") as ((args: { github: unknown; context: unknown; core: unknown }) => Promise<void>) & {
   versionOnly: (files: string, patch: string) => boolean;
};
const prepare = preflight;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

it.each(["public", "unpublished", "draft", "private", "explicit", "superseded", "reserved", "invalid"])(
   "preflight handles %s before building",
   async (scenario) => {
      const outputs = new Map<string, string>();
      const github = {
         paginate: vi.fn(async () => [{ context: "Release candidate", state: "success" }]),
         rest: {
            repos: {
               listCommitStatusesForRef: vi.fn(),
               getReleaseByTag: vi.fn(async () => {
                  if (["unpublished", "reserved"].includes(scenario)) throw Object.assign(new Error("absent"), { status: 404 });
                  return { data: { draft: scenario === "draft" } };
               }),
            },
            git: {
               getRef: vi.fn(async ({ ref }: { ref: string }) => {
                  if (ref.startsWith("tags/") && scenario !== "reserved") throw Object.assign(new Error("absent"), { status: 404 });
                  return { data: { object: { sha: scenario === "superseded" ? "b".repeat(40) : commit } } };
               }),
            },
         },
      };
      const context = {
         sha: commit,
         ref: "refs/heads/main",
         repo: { owner: "NoomStuff", repo: "AcroClip" },
         payload: {
            inputs: {
               verify_candidate: scenario === "private" ? "true" : "false",
               candidate_sha: scenario === "explicit" ? commit : scenario === "invalid" ? "main" : "",
            },
         },
      };
      const core = {
         setOutput: (key: string, value: string) => outputs.set(key, value),
         notice: vi.fn(),
         summary: { addRaw: () => ({ write: async () => undefined }) },
      };
      if (["reserved", "invalid"].includes(scenario)) await expect(prepare({ github, context, core })).rejects.toThrow();
      else {
         await prepare({ github, context, core });
         expect(outputs.get("candidate_sha")).toBe(commit);
         // Every current main commit is a full candidate. Only superseded commits skip packaging.
         expect(outputs.get("build")).toBe(String(scenario !== "superseded"));
         expect(outputs.get("publish")).toBe(String(["unpublished", "draft"].includes(scenario)));
      }
   }
);

it("recognises a commit that only changes the version", () => {
   const bump = ["--- a/package.json", "+++ b/package.json", "@@ -3 +3 @@", '-   "version": "0.22.0",', '+   "version": "0.23.0",', ""].join("\n");
   expect(preflight.versionOnly("package.json\n", bump)).toBe(true);
   expect(preflight.versionOnly("package.json\nsrc/main/index.ts\n", bump)).toBe(false);
   const dependency = [bump, "@@ -40 +40 @@", '-      "zod": "4.6.5"', '+      "zod": "4.7.0"', ""].join("\n");
   expect(preflight.versionOnly("package.json\n", dependency)).toBe(false);
   expect(preflight.versionOnly("package.json\n", ["@@ -12 +12 @@", '-      "test": "a",', '+      "test": "b",', ""].join("\n"))).toBe(false);
});
