// Vendor wallet module. Plain code, NO LLM imports. Holds everything sensitive:
// supplier identities, stealth meta-addresses, keys, payment history.
// The only surface the agent layer may call is handles() / checkOffer() / pay(), and their
// return values contain handle, qty, price, status and tx hash only.
import { keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { randomNonce, signIntent, type Intent } from "../lib/intent";
import { invoiceHash, makeInvoice, type Invoice } from "../lib/invoice";
import { generateStealthKeys, generateStealthPayment, type StealthMetaAddress } from "../lib/stealth";
import type { Relayer, TxResult } from "../relayer/relayer";

export interface SupplierRecord {
  legalName: string; // real identity: never leaves this module
  meta: StealthMetaAddress;
}

export interface Policy {
  maxQty: number;
  minUnitPrice: number; // whole-token decimals, e.g. 9.5
  maxUnitPrice: number;
}

export interface WalletConfig {
  vault: PrivateKeyAccount; // pseudonymous vault key (not the treasury)
  identity: PrivateKeyAccount; // signs invoices off-chain
  registry: Record<string, SupplierRecord>;
  policy: Policy;
  chainId: number;
  settlement: Address;
  relayer: Relayer;
  usualHandle?: string; // "my usual supplier" resolves to this handle
  /** Supplier counter-signs the agreed invoice (verifies terms itself). Off-chain only. */
  countersign?: (handle: string, invoice: Invoice) => Promise<Hex>;
  deadlineSecs?: number;
}

/** What the agent layer may see. */
export interface PayReceipt {
  handle: string;
  qty: number;
  unitPrice: number;
  status: "settled" | "failed";
  txHash: Hex;
}

interface HistoryEntry {
  handle: string;
  legalName: string;
  stealthAddress: Address;
  invoice: Invoice;
  invoiceHash: Hex;
  vendorInvoiceSig: Hex;
  supplierInvoiceSig?: Hex;
  txHash: Hex;
  at: number;
}

export type OfferCheck = { ok: true } | { ok: false; reason: string };

export interface BatchItem {
  kind: "real" | "decoy";
  intent: Intent;
  sig: Hex;
  handle?: string;
  qty?: number;
  unitPrice?: number;
}

export class VendorWallet {
  #history: HistoryEntry[] = [];
  #invoices = new Map<string, { invoice: Invoice; hash: Hex; sig: Hex; supplierSig?: Hex }>();

  constructor(private cfg: WalletConfig) {}

  /** Safe for the LLM: opaque handles only. */
  handles(): string[] {
    return Object.keys(this.cfg.registry);
  }

  usualHandle(): string | undefined {
    return this.cfg.usualHandle;
  }

  /** Abstracted history the LLM layer may see: handle, qty, status. No names, addresses, hashes. */
  historySummary(): { handle: string; qty: number; unitPrice: number }[] {
    return this.#history.map((h) => ({
      handle: h.handle,
      qty: Number(h.invoice.qty),
      unitPrice: Number(h.invoice.unitPrice) / 1e18,
    }));
  }

  /** TEST ONLY: strings that must never appear in any LLM context. */
  secretMarkersForLeakTest(): string[] {
    const out: string[] = [this.cfg.vault.address, this.cfg.identity.address];
    for (const r of Object.values(this.cfg.registry)) out.push(r.legalName, r.meta.spendPub, r.meta.viewPub);
    for (const h of this.#history) out.push(h.stealthAddress, h.txHash, h.legalName);
    return out;
  }

  checkOffer(handle: string, qty: number, unitPrice: number): OfferCheck {
    const p = this.cfg.policy;
    if (!this.cfg.registry[handle]) return { ok: false, reason: `unknown handle ${handle}` };
    if (!Number.isInteger(qty) || qty <= 0 || qty > p.maxQty) return { ok: false, reason: `qty must be 1..${p.maxQty}` };
    if (unitPrice < p.minUnitPrice || unitPrice > p.maxUnitPrice)
      return { ok: false, reason: `unit price outside policy band` };
    return { ok: true };
  }

  /** Build + sign a real payment intent. Amount is fixed by the agreed invoice, not by the caller. */
  async prepare(handle: string, qty: number, unitPrice: number): Promise<BatchItem & { invoice: Invoice }> {
    const check = this.checkOffer(handle, qty, unitPrice);
    if (!check.ok) throw new Error(check.reason);
    const supplier = this.cfg.registry[handle];
    const invoice = makeInvoice(qty, parseUnits(String(unitPrice), 18));
    const hash = invoiceHash(invoice);
    const sig = await this.cfg.identity.signMessage({ message: { raw: hash } });
    const supplierSig = this.cfg.countersign ? await this.cfg.countersign(handle, invoice) : undefined;
    this.#invoices.set(hash, { invoice, hash, sig, supplierSig });
    const sp = generateStealthPayment(supplier.meta);
    const intent = await this.#intent(sp.stealthAddress, BigInt(invoice.total), hash, sp.ephemeralPubKey, sp.viewTag);
    return {
      kind: "real",
      handle,
      qty,
      unitPrice,
      invoice,
      intent: intent.intent,
      sig: intent.sig,
    };
  }

  async pay(handle: string, qty: number, unitPrice: number): Promise<PayReceipt> {
    const item = await this.prepare(handle, qty, unitPrice);
    const res = await this.cfg.relayer.submitIntent(item.intent, item.sig);
    this.#record(item, res);
    return { handle, qty, unitPrice, status: res.ok ? "settled" : "failed", txHash: res.hash };
  }

  /** Decoy: full fake payment through the same code path. Random recipient, random invoice, in-band amount. */
  async decoy(): Promise<BatchItem> {
    const p = this.cfg.policy;
    const qty = 1 + Math.floor(Math.random() * p.maxQty);
    const price = p.minUnitPrice + Math.random() * (p.maxUnitPrice - p.minUnitPrice);
    const amount = parseUnits((qty * Math.round(price * 100) / 100).toFixed(2), 18);
    const throwaway = generateStealthKeys().meta; // nobody holds these keys: funds are burned
    const sp = generateStealthPayment(throwaway);
    const hash = keccak256(stringToHex(`decoy-${Math.random()}-${Date.now()}`));
    const { intent, sig } = await this.#intent(sp.stealthAddress, amount, hash, sp.ephemeralPubKey, sp.viewTag);
    return { kind: "decoy", intent, sig };
  }

  /** Fire real payments mixed with `decoys` fake ones, concurrently, shuffled. */
  async payBatch(
    reals: { handle: string; qty: number; unitPrice: number }[],
    decoys: number,
  ): Promise<{ item: BatchItem; result: TxResult }[]> {
    const realItems = await Promise.all(reals.map((r) => this.prepare(r.handle, r.qty, r.unitPrice)));
    const decoyItems = await Promise.all(Array.from({ length: decoys }, () => this.decoy()));
    const all: BatchItem[] = [...realItems, ...decoyItems].sort(() => Math.random() - 0.5);
    const results = await this.cfg.relayer.burst(all.map((x) => ({ intent: x.intent, sig: x.sig })));
    all.forEach((item, i) => {
      if (item.kind === "real") this.#record(item as BatchItem & { invoice: Invoice }, results[i]);
    });
    return all.map((item, i) => ({ item, result: results[i] }));
  }

  /** Vault key address is public via calldata; exposed for seeding/deposits only. */
  get vaultAddress(): Address {
    return this.cfg.vault.address;
  }

  /** Auditor export (future: gated by viewing key). Plain code only, never wired to an agent tool. */
  auditExport() {
    return this.#history.map((h) => ({ ...h }));
  }

  async #intent(stealthAddr: Address, amount: bigint, hash: Hex, ephemeralPubKey: Hex, viewTag: Hex) {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (this.cfg.deadlineSecs ?? 300));
    const intent: Intent = { stealthAddr, amount, invoiceHash: hash, ephemeralPubKey, viewTag, nonce: randomNonce(), deadline };
    const sig = await signIntent(this.cfg.vault, this.cfg.chainId, this.cfg.settlement, intent);
    return { intent, sig };
  }

  #record(item: BatchItem & { invoice?: Invoice }, res: TxResult) {
    if (item.kind !== "real" || !item.handle) return;
    const rec = this.#invoices.get(item.intent.invoiceHash)!;
    this.#history.push({
      handle: item.handle,
      legalName: this.cfg.registry[item.handle].legalName,
      stealthAddress: item.intent.stealthAddr,
      invoice: rec.invoice,
      invoiceHash: rec.hash,
      vendorInvoiceSig: rec.sig,
      supplierInvoiceSig: rec.supplierSig,
      txHash: res.hash,
      at: res.confirmedAt,
    });
  }
}
