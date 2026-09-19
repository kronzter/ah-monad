import { keccak256, stringToHex, type Hex } from "viem";

/**
 * Canonical invoice. Deliberately contains NO handle, name, or address, so the hash
 * (the only thing that goes on-chain) and the JSON an auditor later reveals never
 * embed supplier identity.
 */
export interface Invoice {
  qty: string;
  unitPrice: string; // token base units
  total: string; // token base units
  terms: string;
  nonce: Hex;
}

export function makeInvoice(qty: number, unitPrice: bigint, terms = "net-0 settle-on-chain"): Invoice {
  const nonce = keccak256(stringToHex(`${Date.now()}-${Math.random()}`));
  return { qty: String(qty), unitPrice: unitPrice.toString(), total: (unitPrice * BigInt(qty)).toString(), terms, nonce };
}

/** Sorted-key JSON so both parties hash identical bytes. */
export function canonicalJson(inv: Invoice): string {
  return JSON.stringify(Object.fromEntries(Object.entries(inv).sort(([a], [b]) => a.localeCompare(b))));
}

export function invoiceHash(inv: Invoice): Hex {
  return keccak256(stringToHex(canonicalJson(inv)));
}
