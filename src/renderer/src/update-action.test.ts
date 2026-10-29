import { expect, it } from "vitest";
import type { UpdateState } from "../../shared/types";
import { updateAction, updateDownloading } from "./update-action";

const available: UpdateState = { state: "available", mode: "download", version: "1.0.0", progress: 0, message: "" };

it("routes update actions through download, retry, reveal and installation", () => {
   expect(updateAction(available)?.method).toBe("downloadUpdate");
   expect(updateAction({ ...available, state: "error" })?.method).toBe("downloadUpdate");
   expect(updateAction({ ...available, mode: "releases" })?.method).toBe("openUpdateRelease");
   expect(updateAction({ ...available, mode: "automatic", state: "error" })?.method).toBe("openUpdateRelease");
   expect(updateAction({ ...available, state: "downloaded" })?.method).toBe("revealUpdate");
   expect(updateAction({ ...available, mode: "automatic", state: "ready" })?.method).toBe("installUpdate");
});

it("offers no competing action while checking or downloading, including an automatic download about to start", () => {
   for (const state of [
      { ...available, state: "idle" as const },
      { ...available, state: "checking" as const },
      { ...available, state: "downloading" as const },
      { ...available, mode: "automatic" as const },
   ])
      expect(updateAction(state)).toBeNull();
   expect(updateDownloading({ ...available, mode: "automatic" })).toBe(true);
});
