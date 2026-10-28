import { describe, expect, it } from "vitest";
import { mapConcurrent } from "./concurrent";

describe("bounded filesystem reads", () => {
   it("keeps input order when reads finish out of order and limits outstanding work", async () => {
      let active = 0,
         maximum = 0;
      const result = await mapConcurrent([30, 10, 5, 2, 1], 2, async (delay, index) => {
         maximum = Math.max(maximum, ++active);
         await new Promise((resolve) => setTimeout(resolve, delay));
         active--;
         return index;
      });
      expect(result).toEqual([0, 1, 2, 3, 4]);
      expect(maximum).toBe(2);
   });
   it("waits for other reads to finish before returning an error", async () => {
      let completed = false;
      await expect(
         mapConcurrent([0, 1], 2, async (index) => {
            if (!index) throw new Error("Disconnected volume");
            await new Promise((resolve) => setTimeout(resolve, 10));
            completed = true;
         })
      ).rejects.toThrow("Disconnected volume");
      expect(completed).toBe(true);
   });
});
