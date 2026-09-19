/**
 * Monad's public RPC rejects eth_getLogs over more than 100 blocks. Split [from, to] into windows and
 * fetch a few at a time. Results are concatenated in block order.
 */
export async function chunkedLogs<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  step = 95n,
  concurrency = 4,
): Promise<T[]> {
  const ranges: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += step) ranges.push([s, s + step - 1n > to ? to : s + step - 1n]);
  const out: T[][] = new Array(ranges.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ranges.length) }, async () => {
      while (i < ranges.length) {
        const k = i++;
        out[k] = await fetchRange(ranges[k][0], ranges[k][1]);
      }
    }),
  );
  return out.flat();
}
