import { afterEach, expect, it, vi } from "vitest";
import { githubSourceApi } from "./github-source-api";

afterEach(() => {
   vi.unstubAllGlobals();
   vi.unstubAllEnvs();
});

it("authenticates source requests and rejects redirects instead of forwarding credentials", async () => {
   vi.stubEnv("GITHUB_TOKEN", "source-test-token");
   const response = new Response("{}", { status: 200 });
   const request = vi.fn().mockResolvedValue(response);
   vi.stubGlobal("fetch", request);
   expect(await githubSourceApi("/repos/Mbed-TLS/mbedtls/git/trees/pinned")).toBe(response);
   const [url, options] = request.mock.calls[0] as [URL, RequestInit];
   expect(url.href).toBe("https://api.github.com/repos/Mbed-TLS/mbedtls/git/trees/pinned");
   expect(new Headers(options.headers).get("Authorization")).toBe("Bearer source-test-token");
   expect(options.redirect).toBe("error");
   expect(options.signal).toBeInstanceOf(AbortSignal);
});

it("supports local source collection without a token and preserves failed responses", async () => {
   vi.stubEnv("GITHUB_TOKEN", "");
   const response = new Response("rate limited", { status: 403 });
   const request = vi.fn().mockResolvedValue(response);
   vi.stubGlobal("fetch", request);
   expect(await githubSourceApi("/repos/owner/project/commits/tag")).toBe(response);
   const [, options] = request.mock.calls[0] as [URL, RequestInit];
   expect(new Headers(options.headers).has("Authorization")).toBe(false);
});

it("rejects non-API destinations before sending a request", async () => {
   vi.stubEnv("GITHUB_TOKEN", "source-test-token");
   const request = vi.fn();
   vi.stubGlobal("fetch", request);
   for (const endpoint of [
      "https://example.com/source",
      "//example.com/source",
      "http://api.github.com/source",
      "https://user:password@api.github.com/source",
   ]) {
      await expect(githubSourceApi(endpoint)).rejects.toThrow("requires the GitHub API");
   }
   expect(request).not.toHaveBeenCalled();
});
