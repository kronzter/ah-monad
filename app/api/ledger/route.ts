import { NextResponse } from "next/server";
import { formatUnits, parseAbiItem } from "viem";
import { chunkedLogs } from "../../../lib/logs";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fromCache = new Map<string, string>();

/** What a competitor's scraper sees (payouts from the Settlement vault), plus what only the supplier's view key can prove. */
export async function GET() {
  try {
    const s = await getSession();
    const pub = s.relayer.publicClient;
    const head = await pub.getBlockNumber();
    const logs = await chunkedLogs(
      (from, to) =>
        pub.getLogs({
          address: s.dep.token,
          event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
          args: { from: s.dep.settlement },
          fromBlock: from,
          toBlock: to,
        }),
      s.startBlock,
      head,
    );
    logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || (a.logIndex! - b.logIndex!));
    const recent = logs.slice(-90);
    const hashes = [...new Set(recent.map((l) => l.transactionHash!))];
    // sender per tx: one getBlock(includeTransactions) per distinct block, not one call per tx.
    // (the public RPC caps at 50 calls/s, so per-tx lookups 429 at burst size)
    const needBlocks = [...new Set(recent.filter((l) => !fromCache.has(l.transactionHash!)).map((l) => l.blockNumber!))];
    for (let i = 0; i < needBlocks.length; i += 4) {
      const blocks = await Promise.all(
        needBlocks.slice(i, i + 4).map((blockNumber) => pub.getBlock({ blockNumber, includeTransactions: true })),
      );
      for (const b of blocks) for (const tx of b.transactions) fromCache.set(tx.hash, tx.from);
    }
    const rows = recent.map((l) => ({
      hash: l.transactionHash!,
      block: l.blockNumber!.toString(),
      txFrom: fromCache.get(l.transactionHash!) ?? "?",
      to: l.args.to!,
      amount: formatUnits(l.args.value!, 18),
    }));
    const found = await s.supplierWallet.scan(s.startBlock);
    return NextResponse.json({
      rows,
      total: logs.length,
      mine: found.map((f) => f.stealthAddress),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
