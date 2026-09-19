// CLI e2e without LLMs: seed vault, real payment, supplier scan + sweep, decoy burst with latency table.
// Run: NETWORK=local tsx script/demo.ts   (needs anvil + `tsx script/deploy.ts` first)
import { formatUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tokenAbi } from "../lib/abis";
import { generateStealthKeys } from "../lib/stealth";
import { Relayer } from "../relayer/relayer";
import { SupplierWallet } from "../wallet/supplierWallet";
import { VendorWallet } from "../wallet/vendorWallet";
import { chain, loadDeployments, relayerKeys, rpcUrl } from "./config";
import { seedVendorVault } from "./seed";

const DECOYS = Number(process.env.DECOYS ?? 50);

async function main() {
  const dep = loadDeployments();
  const relayer = new Relayer(chain, rpcUrl, relayerKeys(), dep);
  const supplierKeys = generateStealthKeys();

  const vendor = new VendorWallet({
    vault: privateKeyToAccount(generatePrivateKey()),
    identity: privateKeyToAccount(generatePrivateKey()),
    registry: { S1: { legalName: "Acme Fasteners Ltd", meta: supplierKeys.meta } },
    policy: { maxQty: 500, minUnitPrice: 8, maxUnitPrice: 15 },
    chainId: dep.chainId,
    settlement: dep.settlement,
    relayer,
  });

  const startBlock = await relayer.publicClient.getBlockNumber();
  console.log("seeding vendor vault...");
  await seedVendorVault(relayer, dep, vendor.vaultAddress, 1_000_000);

  console.log("\n== 1. real payment ==");
  const receipt = await vendor.pay("S1", 200, 12);
  console.log(receipt);

  const supplier = new SupplierWallet(
    chain,
    rpcUrl,
    supplierKeys,
    privateKeyToAccount(generatePrivateKey()),
    dep,
    relayer,
  );
  const found = await supplier.scan(startBlock);
  console.log(`supplier scan found ${found.length} payment(s):`, found.map((f) => formatUnits(f.balance, 18)));
  if (found.length) {
    const sw = await supplier.sweep(found[0]);
    console.log("sweep tx", sw.hash, sw.ok ? "ok" : "FAILED");
  }

  console.log(`\n== 2. burst: 3 real + ${DECOYS} decoys ==`);
  const t0 = Date.now();
  const out = await vendor.payBatch(
    [
      { handle: "S1", qty: 100, unitPrice: 11 },
      { handle: "S1", qty: 250, unitPrice: 9.5 },
      { handle: "S1", qty: 50, unitPrice: 14 },
    ],
    DECOYS,
  );
  const wall = Date.now() - t0;
  const lat = out.map((o) => o.result.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
  console.log(`txs=${out.length} ok=${out.filter((o) => o.result.ok).length} wall=${wall}ms`);
  console.log(`latency ms: min=${lat[0]} p50=${pct(0.5)} p90=${pct(0.9)} max=${lat[lat.length - 1]}`);
  const bc = out.map((o) => o.result.broadcastMs).sort((a, b) => a - b);
  console.log(`broadcast ms (RPC accept): p50=${bc[Math.floor(bc.length / 2)]} max=${bc[bc.length - 1]}  txs needing retry=${out.filter((o) => o.result.attempts > 1).length}`);
  console.log(`inclusion after broadcast ms: p50=${[...out.map((o) => o.result.latencyMs - o.result.broadcastMs)].sort((a, b) => a - b)[Math.floor(out.length / 2)]}`);
  console.log(`blocks spanned: ${new Set(out.map((o) => o.result.blockNumber)).size}`);

  const refound = await supplier.scan(startBlock);
  console.log(`supplier still finds only its ${refound.length} real payments out of ${out.length + 1} announcements`);
  const bal = await relayer.publicClient.readContract({
    address: dep.token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [dep.settlement],
  });
  console.log("settlement token balance", formatUnits(bal, 18));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
