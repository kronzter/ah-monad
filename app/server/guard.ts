// Guards for a publicly hosted demo: the relayer key pays gas and the LLM key pays tokens, so the
// expensive routes are serialized and rate-limited (per server instance).
import { NextResponse } from "next/server";
import { formatEther } from "viem";
import type { Session } from "./session";

const last = new Map<string, number>();
const inflight = new Set<string>();

export async function guarded(route: string, cooldownMs: number, run: () => Promise<Response>): Promise<Response> {
  if (inflight.has(route)) return NextResponse.json({ error: "another run is in progress, try again in a moment" }, { status: 429 });
  const wait = (last.get(route) ?? 0) + cooldownMs - Date.now();
  if (wait > 0) return NextResponse.json({ error: `cooling down, retry in ${Math.ceil(wait / 1000)}s` }, { status: 429 });
  inflight.add(route);
  try {
    return await run();
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  } finally {
    inflight.delete(route);
    last.set(route, Date.now());
  }
}

/** Below Monad's 10 MON reserve floor the relayer is throttled to 1 tx / ~1.2s, so refuse bursts instead. */
export async function requireRelayerFunds(s: Session): Promise<Response | null> {
  const min = Number(process.env.MIN_RELAYER_MON ?? 10.5);
  const bal = await s.relayer.publicClient.getBalance({ address: s.relayer.addresses[0] });
  if (Number(formatEther(bal)) < min)
    return NextResponse.json(
      { error: `demo relayer is low on testnet MON (${Number(formatEther(bal)).toFixed(2)}). Fund ${s.relayer.addresses[0]} and retry.` },
      { status: 503 },
    );
  return null;
}
