/**
 * Run `fn` over `items` with at most `concurrency` in flight at once.
 * Returns Promise.allSettled-style results in input order so callers can
 * count successes/failures without one rejection tanking the rest.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  const width = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  await Promise.all(
    Array.from({ length: width }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { status: "fulfilled", value: await fn(items[i]!, i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}
