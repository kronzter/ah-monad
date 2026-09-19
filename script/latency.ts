// Single-payment latency: N sequential payments, each sent alone. Isolates chain finality from burst/RPC pressure.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { generateStealthKeys } from "../lib/stealth";
import { Relayer } from "../relayer/relayer";
import { VendorWallet } from "../wallet/vendorWallet";
import { chain, loadDeployments, relayerKeys, rpcUrl } from "./config";
import { seedVendorVault } from "./seed";

async function main() {
  const dep = loadDeployments();
  const relayer = new Relayer(chain, rpcUrl, relayerKeys(), dep);
  const vendor = new VendorWallet({
    vault: privateKeyToAccount(generatePrivateKey()),
    identity: privateKeyToAccount(generatePrivateKey()),
    registry: { S1: { legalName: "x", meta: generateStealthKeys().meta } },
    policy: { maxQty: 500, minUnitPrice: 8, maxUnitPrice: 15 },
    chainId: dep.chainId, settlement: dep.settlement, relayer,
  });
  await seedVendorVault(relayer, dep, vendor.vaultAddress, 100_000);
  const rows: { total: number; broadcast: number; incl: number }[] = [];
  for (let i = 0; i < Number(process.env.N ?? 8); i++) {
    const item = await vendor.prepare("S1", 100, 10);
    const r = await relayer.submitIntent(item.intent, item.sig);
    rows.push({ total: r.latencyMs, broadcast: r.broadcastMs, incl: r.latencyMs - r.broadcastMs });
    console.log(`#${i + 1} total=${r.latencyMs}ms broadcast=${r.broadcastMs}ms inclusion=${r.latencyMs - r.broadcastMs}ms attempts=${r.attempts} block=${r.blockNumber}`);
  }
  const t = rows.map((r) => r.total).sort((a, b) => a - b);
  console.log(`total ms: min=${t[0]} median=${t[Math.floor(t.length / 2)]} max=${t[t.length - 1]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
