import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionRefresh, FALLBACK_POLL_MS, UNWATCHED_POLL_MS } from "./collection-refresh";

const roots: string[] = [];
const refreshers: CollectionRefresh[] = [];
afterEach(async () => {
   vi.useRealTimers();
   for (const refresher of refreshers.splice(0)) refresher.close();
   for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function collection() {
   const root = await mkdtemp(join(tmpdir(), "acroclip-refresh-"));
   roots.push(root);
   await mkdir(join(root, ".acroclip", "thumbnails"), { recursive: true });
   await mkdir(join(root, "Nested"));
   return root;
}
function refresher(options: Partial<ConstructorParameters<typeof CollectionRefresh>[0]> = {}) {
   const refresh = vi.fn(async () => undefined);
   const value = new CollectionRefresh({ refresh, busy: () => false, log: () => undefined, ...options });
   refreshers.push(value);
   return { value, refresh };
}

it("refreshes when shown, follows real file changes, and ignores AcroClip's own writes", async () => {
   const root = await collection();
   const { value, refresh } = refresher();
   value.update(root, true);
   await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
   await writeFile(join(root, ".acroclip", "collection.json"), "{}");
   await writeFile(join(root, ".acroclip", "thumbnails", "a.jpg"), "image");
   await writeFile(join(root, "Nested", ".acroclip-export.mp4"), "temporary");
   await new Promise((resolve) => setTimeout(resolve, 600));
   expect(refresh).toHaveBeenCalledTimes(1);
   await writeFile(join(root, "Nested", "Moment.mp4"), "video");
   await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2), { timeout: 3000 });
});

it("does no filesystem work while hidden and catches up when shown again", async () => {
   const root = await collection();
   const { value, refresh } = refresher();
   value.update(root, true);
   await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
   value.update(root, false);
   await writeFile(join(root, "Moment.mp4"), "video");
   await new Promise((resolve) => setTimeout(resolve, 600));
   expect(refresh).toHaveBeenCalledTimes(1);
   value.update(root, true);
   await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
});

it("polls slowly beside a watcher, quickly without one, and waits for exports", async () => {
   vi.useFakeTimers();
   const watched = refresher({ watch: (() => ({ on: () => undefined, close: () => undefined })) as never });
   watched.value.update("/collection", true);
   await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS * 2 + 10);
   expect(watched.refresh).toHaveBeenCalledTimes(3);
   let busy = true;
   const unwatched = refresher({
      busy: () => busy,
      watch: () => {
         throw new Error("ENOSPC");
      },
   });
   unwatched.value.update("/collection", true);
   await vi.advanceTimersByTimeAsync(UNWATCHED_POLL_MS * 2 + 10);
   expect(unwatched.refresh).not.toHaveBeenCalled();
   busy = false;
   await vi.advanceTimersByTimeAsync(UNWATCHED_POLL_MS * 2);
   expect(unwatched.refresh).toHaveBeenCalledTimes(2);
});
