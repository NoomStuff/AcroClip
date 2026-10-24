/** Keep source-verification credentials on the GitHub API, including redirects. */
export async function githubSourceApi(endpoint: string): Promise<Response> {
   const url = new URL(endpoint, "https://api.github.com");
   if (url.origin !== "https://api.github.com" || url.username || url.password) throw new Error("Source verification requires the GitHub API.");
   const headers = new Headers({ Accept: "application/vnd.github+json", "User-Agent": "AcroClip-source-collector", "X-GitHub-Api-Version": "2022-11-28" });
   const token = process.env["GITHUB_TOKEN"];
   if (token) headers.set("Authorization", `Bearer ${token}`);
   return fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
}
