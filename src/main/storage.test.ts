import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lowStorageDetail, StorageMonitor } from "./storage";
const monitors: StorageMonitor[] = [];
afterEach(() => {
   monitors.splice(0).forEach((monitor) => monitor.close());
   vi.useRealTimers();
});
function monitor(readSpace?: (root: string) => Promise<bigint>) {
   const messages: string[] = [];
   const changes: string[] = [];
   const unreadable: string[] = [];
   const value = new StorageMonitor({
      onChange: () => changes.push(value.warning),
      onWarning: (message) => messages.push(message),
      onUnreadable: () => unreadable.push(value.warning),
      ...(readSpace ? { readSpace } : {}),
   });
   monitors.push(value);
   return { value, messages, changes, unreadable };
}
describe("collection free-space warning", () => {
   it("uses actual bigint filesystem stats for an isolated folder", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-space-read-"));
      try {
         const stats = await statfs(root, { bigint: true });
         const { value } = monitor();
         value.setActivity(root, false);
         await value.check(root);
         expect(value.warning).toBe(stats.bavail * stats.bsize < 1024n ** 3n ? "Low storage" : "");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("reads the volume of a collection folder that doesn't exist yet", async () => {
      const root = await mkdtemp(join(tmpdir(), "acroclip-space-missing-"));
      try {
         const stats = await statfs(root, { bigint: true });
         const { value } = monitor();
         const missing = join(root, "deleted", "Clips");
         value.setActivity(missing, false);
         await value.check(missing);
         expect(value.warning).toBe(stats.bavail * stats.bsize < 1024n ** 3n ? "Low storage" : "");
      } finally {
         await rm(root, { recursive: true, force: true });
      }
   });
   it("warns below 1 GiB, deduplicates, and clears only when space recovers", async () => {
      let bytes = 1024n ** 3n;
      const { value, messages, changes } = monitor(async () => bytes);
      value.setActivity("fixture", false);
      await value.check("fixture");
      expect(value.warning).toBe("");
      bytes--;
      await value.check("fixture");
      await value.check("fixture");
      expect(messages).toEqual(["Low storage"]);
      bytes = 0n;
      await value.check("fixture");
      expect(messages).toHaveLength(1);
      bytes = 1024n ** 3n;
      await value.check("fixture");
      expect(changes).toEqual(["Low storage", ""]);
   });
   it("polls only while work is active, at 30-second intervals", async () => {
      vi.useFakeTimers();
      const read = vi.fn(async () => 0n);
      const { value } = monitor(read);
      value.setActivity("first", false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).not.toHaveBeenCalled();
      value.setActivity("first", true);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(2);
      value.setActivity("second", true);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(read.mock.calls.slice(-2)).toEqual([["second"], ["second"]]);
      value.setActivity("second", false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(read).toHaveBeenCalledTimes(4);
   });
   it("does not label a failed or timed-out query as a full disk, and reports it once", async () => {
      const failed = monitor(async () => {
         throw new Error("Disconnected volume");
      });
      failed.value.setActivity("fixture", false);
      await failed.value.check("fixture");
      await failed.value.check("fixture");
      expect(failed.value.warning).toBe("");
      expect(failed.messages).toEqual([]);
      expect(failed.unreadable).toHaveLength(1);
      vi.useFakeTimers();
      const timeout = monitor(() => new Promise(() => undefined));
      timeout.value.setActivity("fixture", false);
      const check = timeout.value.check("fixture");
      await vi.advanceTimersByTimeAsync(3000);
      await check;
      expect(timeout.value.warning).toBe("");
      expect(timeout.unreadable).toHaveLength(1);
   });
   it("keeps a low-storage warning while the volume can't be read", async () => {
      let bytes: bigint | undefined = 0n;
      const { value, messages } = monitor(async () => {
         if (bytes === undefined) throw new Error("Disconnected volume");
         return bytes;
      });
      value.setActivity("fixture", false);
      await value.check("fixture");
      bytes = undefined;
      await value.check("fixture");
      expect(value.warning).toBe("Low storage");
      expect(messages).toEqual(["Low storage"]);
   });
   it("says how much is left and on which drive", () => {
      expect(lowStorageDetail("D:\\Clips", 820n * 1024n * 1024n + 5n, "win32")).toBe("Only 820 MB left on D:, so new clips may not save.");
      expect(lowStorageDetail("/home/user/Clips", 12n * 1024n * 1024n, "linux")).toBe("Only 12 MB left on the collection's drive, so new clips may not save.");
   });
   it("does not publish stale results from a previous collection or after shutdown", async () => {
      let resolve: ((bytes: bigint) => void) | undefined;
      const { value, messages } = monitor(
         () =>
            new Promise((done) => {
               resolve = done;
            })
      );
      value.setActivity("first", false);
      const check = value.check("first");
      value.setActivity("second", false);
      resolve?.(0n);
      await check;
      expect(messages).toEqual([]);
      const last = value.check("second");
      value.close();
      resolve?.(0n);
      await last;
      expect(messages).toEqual([]);
   });
   it("does not accumulate filesystem reads when a volume stops responding", async () => {
      vi.useFakeTimers();
      const read = vi.fn(() => new Promise<bigint>(() => undefined));
      const { value } = monitor(read);
      value.setActivity("network-volume", true);
      await vi.advanceTimersByTimeAsync(95_000);
      expect(read).toHaveBeenCalledTimes(1);
      expect(value.warning).toBe("");
   });
});
