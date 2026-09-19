import { NextResponse } from "next/server";
import { guarded, requireRelayerFunds } from "../../server/guard";
import { ensureVault, getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Scripted reorders standing in for "the real payments" in the flood. Both sides already agreed these terms.
const REAL = [
  { handle: "S1", qty: 100, unitPrice: 11 },
  { handle: "S1", qty: 250, unitPrice: 10.5 },
  { handle: "S1", qty: 50, unitPrice: 12 },
];

export async function POST(req: Request) {
  return guarded("burst", 20_000, async () => {
    const { decoys = 50 } = (await req.json().catch(() => ({}))) as { decoys?: number };
    const n = Math.max(0, Math.min(60, Math.floor(decoys)));
    const s = await getSession();
    const low = await requireRelayerFunds(s);
    if (low) return low;
    await ensureVault(s);
    s.terms.push(...REAL.map((r) => ({ qty: r.qty, unitPrice: r.unitPrice })));
    const t0 = Date.now();
    const out = await s.vendor.payBatch(REAL, n);
    const wallMs = Date.now() - t0;
    // deliberately NO real/decoy flag in the response: only the supplier's view key can tell them apart
    return NextResponse.json({
      wallMs,
      txs: out.map((o) => ({
        hash: o.result.hash,
        ok: o.result.ok,
        block: o.result.blockNumber.toString(),
        latencyMs: o.result.latencyMs,
        broadcastMs: o.result.broadcastMs,
      })),
    });
  });
}
