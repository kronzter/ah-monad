/**
 * Monad's public RPC rejects eth_getLogs over more than 100 blocks. Split [from, to] into windows and
 * fetch a few at a time. Results are concatenated in block order.
 */
export async function chunkedLogs<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  step = 95n,
  concurrency = 2,
): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += step) ranges.push([s, s + step - 1n > to ? to : s + step - 1n]);
  const out: T[][] = new Array(ranges.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ranges.length) }, async () => {
      while (i < ranges.length) {
        const k = i++;
        out[k] = await withRetry(() => fetchRange(ranges[k][0], ranges[k][1]));
      }
    }),
  );
  return out.flat();
}

/** The public RPC answers 429 ("requests limited to N/sec") in bursts: back off and retry the same window. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !/429|too many|limit/i.test(String((e as Error).message ?? e))) throw e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
  }
}
