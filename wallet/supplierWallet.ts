// Supplier wallet module. Plain code, NO LLM imports.
// Scans Announcement logs by view tag, recovers stealth keys, sweeps into a pseudonymous vault key
// through a permit signed by the stealth key (relayer pays gas).
import { createPublicClient, http, parseEventLogs, parseUnits, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { announcerAbi, tokenAbi } from "../lib/abis";
import { chunkedLogs } from "../lib/logs";
import { invoiceHash, type Invoice } from "../lib/invoice";
import { checkAnnouncement, computeStealthKey, type StealthKeys } from "../lib/stealth";
import type { Relayer, TxResult } from "../relayer/relayer";
import type { Deployments } from "../script/config";

export interface FoundPayment {
  stealthAddress: Address;
  ephemeralPubKey: Hex;
  balance: bigint;
  blockNumber: bigint;
}

export class SupplierWallet {
  readonly pub: PublicClient;
  #keys: StealthKeys;

  constructor(
    chain: Chain,
    rpcUrl: string,
    keys: StealthKeys,
    private sweepVault: PrivateKeyAccount, // pseudonymous vault key that receives sweeps
    private dep: Deployments,
    private relayer: Relayer,
    private identity?: PrivateKeyAccount, // signs agreed invoices
  ) {
    this.pub = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 6, retryDelay: 250 }) });
    this.#keys = keys;
  }

  get meta() {
    return this.#keys.meta;
  }

  /** Counter-sign an invoice only if it matches the terms the supplier agent agreed to. */
  async countersign(invoice: Invoice, agreed: { qty: number; unitPrice: number }): Promise<Hex> {
    if (!this.identity) throw new Error("no supplier identity key");
    const ok =
      Number(invoice.qty) === agreed.qty &&
      BigInt(invoice.unitPrice) === parseUnits(String(agreed.unitPrice), 18) &&
      BigInt(invoice.total) === BigInt(invoice.unitPrice) * BigInt(agreed.qty);
    if (!ok) throw new Error("invoice does not match agreed terms");
    return this.identity.signMessage({ message: { raw: invoiceHash(invoice) } });
  }

  async scan(fromBlock: bigint): Promise<FoundPayment[]> {
    const head = await this.pub.getBlockNumber();
    const raw = await chunkedLogs(
      (from, to) => this.pub.getLogs({ address: this.dep.announcer, fromBlock: from, toBlock: to }),
      fromBlock,
      head,
    );
    const logs = parseEventLogs({ abi: announcerAbi, eventName: "Announcement", logs: raw });
    const found: FoundPayment[] = [];
    for (const l of logs) {
      const tag = ("0x" + l.args.metadata.slice(2, 4)) as Hex;
      const addr = checkAnnouncement(this.#keys.viewPriv, this.#keys.meta.spendPub, l.args.ephemeralPubKey, tag);
      if (!addr || addr.toLowerCase() !== l.args.stealthAddress.toLowerCase()) continue;
      const balance = await this.pub.readContract({
        address: this.dep.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [addr],
      });
      found.push({ stealthAddress: addr, ephemeralPubKey: l.args.ephemeralPubKey, balance, blockNumber: l.blockNumber });
    }
    return found;
  }

  /** Sweep a found stealth balance into the supplier vault, gasless for the supplier. */
  async sweep(p: FoundPayment): Promise<TxResult> {
    const stealthAcc = privateKeyToAccount(computeStealthKey(this.#keys.spendPriv, this.#keys.viewPriv, p.ephemeralPubKey));
    if (stealthAcc.address.toLowerCase() !== p.stealthAddress.toLowerCase()) throw new Error("stealth key mismatch");
    const [name, nonce] = await Promise.all([
      this.pub.readContract({ address: this.dep.token, abi: tokenAbi, functionName: "name" }),
      this.pub.readContract({ address: this.dep.token, abi: tokenAbi, functionName: "nonces", args: [stealthAcc.address] }),
    ]);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const signature = await stealthAcc.signTypedData({
      domain: { name, version: "1", chainId: this.dep.chainId, verifyingContract: this.dep.token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: stealthAcc.address, spender: this.dep.settlement, value: p.balance, nonce, deadline },
    });
    const r = `0x${signature.slice(2, 66)}` as Hex;
    const s = `0x${signature.slice(66, 130)}` as Hex;
    const v = parseInt(signature.slice(130, 132), 16);
    return this.relayer.depositWithPermit(this.sweepVault.address, {
      owner: stealthAcc.address,
      amount: p.balance,
      deadline,
      v,
      r,
      s,
    });
  }
}
