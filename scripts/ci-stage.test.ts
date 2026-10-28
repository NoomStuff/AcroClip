import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { candidateIdentity, sha256, targets } from "./ci-candidate";
import { checkPackageFiles, collectForSeal } from "./ci-stage";

it("rejects a modified restored executable even if the transport tar stayed unchanged", async () => {
   const root = await mkdtemp(path.join(tmpdir(), "ci-package-"));
   try {
      await mkdir(path.join(root, "resources"));
      await mkdir(path.join(root, ".cache"));
      const file = path.join(root, "resources", "recorder.exe");
      await writeFile(file, "original package bytes");
      const info = await lstat(file);
      await writeFile(
         path.join(root, ".cache/.ci-package-files.json"),
         JSON.stringify([{ path: "resources/recorder.exe", kind: "file", size: info.size, sha256: await sha256(file), executable: !!(info.mode & 0o111) }])
      );
      await checkPackageFiles(root);
      await writeFile(file, "changed package bytes");
      await expect(checkPackageFiles(root)).rejects.toThrow("Tested package changed");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});

it.each(["valid", "missing-target", "extra-target", "bytes", "run", "manifest", "receipt", "extra-file"])("seals verified targets: %s", async (scenario) => {
   const root = await mkdtemp(path.join(tmpdir(), "ci-targets-"));
   const input = path.join(root, "verified");
   vi.stubEnv("CANDIDATE_SHA", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
   vi.stubEnv("GITHUB_RUN_ID", "123");
   try {
      await mkdir(input);
      for (const target of targets) {
         const directory = path.join(input, `verified-${target}`);
         await mkdir(directory);
         const identity = await candidateIdentity(target);
         await writeFile(
            path.join(directory, "manifest.json"),
            JSON.stringify({ ...identity, files: [{ path: "payload.tar", size: 1, sha256: "a".repeat(64) }] })
         );
         const filename = `download-${target}.bin`;
         await writeFile(path.join(directory, filename), target);
         const receipt = {
            ...identity,
            candidateSha256: await sha256(path.join(directory, "manifest.json")),
            files: [{ path: filename, size: target.length, sha256: await sha256(path.join(directory, filename)) }],
         };
         if (target === "win-x64") {
            if (scenario === "run") receipt.runId = "456";
            if (scenario === "receipt") receipt.candidateSha256 = "b".repeat(64);
            if (scenario === "bytes") await writeFile(path.join(directory, filename), "altered");
            if (scenario === "extra-file") await writeFile(path.join(directory, "extra.exe"), "unexpected");
            if (scenario === "manifest") await writeFile(path.join(directory, "manifest.json"), "{}");
         }
         await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt));
      }
      if (scenario === "missing-target") await rm(path.join(input, "verified-win-x64"), { recursive: true });
      if (scenario === "extra-target") await mkdir(path.join(input, "verified-extra"));
      const output = path.join(root, "seal");
      if (scenario === "valid") {
         await collectForSeal(input, output);
         expect(await readFile(path.join(output, "win-x64/download-win-x64.bin"), "utf8")).toBe("win-x64");
      } else await expect(collectForSeal(input, output)).rejects.toThrow();
   } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
   }
});
