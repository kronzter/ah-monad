// Server-side singleton: relayer, wallets and agents live here, never in the browser.
import { keccak256, stringToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SupplierAgent } from "../../agents/supplier";
import { generateStealthKeys, stealthKeysFromPrivs } from "../../lib/stealth";
import { Relayer } from "../../relayer/relayer";
import { chain, loadDeployments, relayerKeys, rpcUrl, type Deployments } from "../../script/config";
import { seedVendorVault } from "../../script/seed";
import { SupplierWallet } from "../../wallet/supplierWallet";
import { VendorWallet } from "../../wallet/vendorWallet";
import { settlementAbi } from "../../lib/abis";

export interface Session {
  dep: Deployments;
  relayer: Relayer;
  supplierAgent: SupplierAgent;
  supplierWallet: SupplierWallet;
  vendor: VendorWallet;
  startBlock: bigint;
  /** Terms the supplier side has agreed to (negotiated or scripted reorder). Countersign checks against these. */
  terms: { qty: number; unitPrice: number }[];
}

const g = globalThis as unknown as { __shade?: Promise<Session> };

export function getSession(): Promise<Session> {
  if (!g.__shade) {
    g.__shade = init().catch((e) => {
      g.__shade = undefined; // allow retry after a failed init
      throw e;
    });
  }
  return g.__shade;
}

async function init(): Promise<Session> {
  const dep = loadDeployments();
  const relayer = new Relayer(chain, rpcUrl, relayerKeys(), dep);
  // With DEMO_SEED every serverless instance derives the SAME supplier, vault and identity keys, so a burst
  // handled by one instance is visible to the ledger handled by another. Without it, keys are random per process.
  const seed = process.env.DEMO_SEED;
  const priv = (label: string): Hex => (seed ? keccak256(stringToHex(`shade:${seed}:${label}`)) : generatePrivateKey());
  const supplierKeys = seed ? stealthKeysFromPrivs(priv("supplier-spend"), priv("supplier-view")) : generateStealthKeys();
  const supplierAgent = new SupplierAgent({ listPrice: 12, floorPrice: 10.5, maxQty: 500 });
  const supplierWallet = new SupplierWallet(
    chain, rpcUrl, supplierKeys, privateKeyToAccount(priv("supplier-sweep-vault")), dep, relayer,
    privateKeyToAccount(priv("supplier-identity")),
  );
  const terms: Session["terms"] = [];
  const vendor = new VendorWallet({
    vault: privateKeyToAccount(priv("vendor-vault")),
    identity: privateKeyToAccount(priv("vendor-identity")),
    registry: { S1: { legalName: "Acme Fasteners Ltd", meta: supplierKeys.meta } },
    usualHandle: "S1",
    policy: { maxQty: 500, minUnitPrice: 8, maxUnitPrice: 15 },
    chainId: dep.chainId,
    settlement: dep.settlement,
    relayer,
    countersign: async (_h, invoice) => {
      const all = supplierAgent.accepted ? [supplierAgent.accepted, ...terms] : terms;
      const t = all.find((x) => x.qty === Number(invoice.qty) && BigInt(invoice.unitPrice) === BigInt(Math.round(x.unitPrice * 100)) * 10n ** 16n);
      if (!t) throw new Error("no agreed terms for this invoice");
      return supplierWallet.countersign(invoice, t);
    },
  });
  const startBlock = await relayer.publicClient.getBlockNumber();
  const session: Session = { dep, relayer, supplierAgent, supplierWallet, vendor, startBlock, terms };
  await ensureVault(session); // seeds only when the (possibly pre-existing) vault is low
  return session;
}

/** Rolling scan window (~10 min of blocks): keeps log scans small on the 100-block-capped public RPC. */
export const SCAN_WINDOW = 1200n;
export const scanFrom = (head: bigint) => (head > SCAN_WINDOW ? head - SCAN_WINDOW : 0n);

/** Decoys burn vault tokens: top up (mock tokens) before a burst if low. */
export async function ensureVault(s: Session, min = 400_000n * 10n ** 18n) {
  const bal = await s.relayer.publicClient.readContract({
    address: s.dep.settlement, abi: settlementAbi, functionName: "vault", args: [s.vendor.vaultAddress],
  });
  if (bal < min) await seedVendorVault(s.relayer, s.dep, s.vendor.vaultAddress, 1_000_000);
}
