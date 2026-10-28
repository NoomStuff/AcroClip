/** Bound filesystem work without changing result order or leaving reads running after failure. */
export async function mapConcurrent<T, R>(values: readonly T[], limit: number, read: (value: T, index: number) => Promise<R>): Promise<R[]> {
   const results = new Array<R>(values.length);
   let cursor = 0;
   const workers = await Promise.allSettled(
      Array.from({ length: Math.min(values.length, Math.max(1, limit)) }, async () => {
         while (cursor < values.length) {
            const index = cursor++;
            results[index] = await read(values[index]!, index);
         }
      })
   );
   for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
   return results;
}
