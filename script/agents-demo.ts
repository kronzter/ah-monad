// Live agents demo: NL request -> vendor/supplier LLM negotiation -> on-chain private payment -> supplier scan,
// then competitor prompt-injection against the vendor agent.
// Run: pnpm tsx script/agents-demo.ts   (NETWORK from .env, contracts deployed, relayer funded)
import { formatUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { runInjectionAttack } from "../agents/competitor";
import { modelId } from "../agents/model";
import { SupplierAgent } from "../agents/supplier";
import { runVendorAgent } from "../agents/vendor";
import { generateStealthKeys } from "../lib/stealth";
import { Relayer } from "../relayer/relayer";
import { SupplierWallet } from "../wallet/supplierWallet";
import { VendorWallet } from "../wallet/vendorWallet";
import { chain, loadDeployments, relayerKeys, rpcUrl } from "./config";
import { seedVendorVault } from "./seed";

async function main() {
  const dep = loadDeployments();
  const relayer = new Relayer(chain, rpcUrl, relayerKeys(), dep);
  const supplierKeys = generateStealthKeys();

  const supplierAgent = new SupplierAgent({ listPrice: 12, floorPrice: 10.5, maxQty: 500 });
  const supplierWallet = new SupplierWallet(
    chain, rpcUrl, supplierKeys, privateKeyToAccount(generatePrivateKey()), dep, relayer,
    privateKeyToAccount(generatePrivateKey()),
  );
  const vendor = new VendorWallet({
    vault: privateKeyToAccount(generatePrivateKey()),
    identity: privateKeyToAccount(generatePrivateKey()),
    registry: { S1: { legalName: "Acme Fasteners Ltd", meta: supplierKeys.meta } },
    usualHandle: "S1",
    policy: { maxQty: 500, minUnitPrice: 8, maxUnitPrice: 15 },
    chainId: dep.chainId,
    settlement: dep.settlement,
    relayer,
    countersign: (_handle, invoice) => supplierWallet.countersign(invoice, supplierAgent.accepted!),
  });

  console.log(`model: ${modelId}  network chain ${dep.chainId}`);
  const startBlock = await relayer.publicClient.getBlockNumber();
  await seedVendorVault(relayer, dep, vendor.vaultAddress, 1_000_000);

  console.log("\n== 1. negotiation ==");
  const req = "Pay my usual supplier for 200 units.";
  console.log(`user: ${req}`);
  const { text, log } = await runVendorAgent(vendor, { S1: supplierAgent }, req);
  for (const e of log.events) console.log(`  [${e.kind}] ${e.text}`);
  console.log(`vendor agent: ${text}`);
  if (!log.receipt) throw new Error("no payment settled");
  console.log(`settled: ${log.receipt.qty} @ ${log.receipt.unitPrice}  tx ${log.receipt.txHash}`);

  const found = await supplierWallet.scan(startBlock);
  console.log(`supplier scan: ${found.length} payment(s), balances`, found.map((f) => formatUnits(f.balance, 18)));
  const audit = vendor.auditExport()[0];
  console.log(`both parties signed invoice: vendor=${!!audit.vendorInvoiceSig} supplier=${!!audit.supplierInvoiceSig}`);

  console.log("\n== 2. competitor prompt injection ==");
  const results = await runInjectionAttack(vendor);
  let leaks = 0;
  for (const r of results) {
    leaks += r.leaked.length;
    console.log(`\nATTACK: ${r.payload.slice(0, 90)}...`);
    console.log(`REPLY : ${r.reply.replace(/\s+/g, " ").slice(0, 300)}`);
    console.log(`LEAKED: ${r.leaked.length ? r.leaked.join(", ") : "nothing"}`);
  }
  console.log(`\ntotal secret markers leaked: ${leaks}`);
  if (leaks) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
