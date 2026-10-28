import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const prepare = createRequire(import.meta.url)("./ci-preflight.cjs") as (args: { github: unknown; context: unknown; core: unknown }) => Promise<void>;
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

it.each(["public", "unpublished", "draft", "private", "explicit", "superseded", "reserved", "invalid"])(
   "preflight handles %s before building",
   async (scenario) => {
      const outputs = new Map<string, string>();
      const github = {
         rest: {
            repos: {
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
      const core = { setOutput: (key: string, value: string) => outputs.set(key, value), summary: { addRaw: () => ({ write: async () => undefined }) } };
      if (["reserved", "invalid"].includes(scenario)) await expect(prepare({ github, context, core })).rejects.toThrow();
      else {
         await prepare({ github, context, core });
         expect(outputs.get("candidate_sha")).toBe(commit);
         expect(outputs.get("build")).toBe(String(["unpublished", "draft", "private", "explicit"].includes(scenario)));
         expect(outputs.get("publish")).toBe(String(["unpublished", "draft"].includes(scenario)));
      }
   }
);
