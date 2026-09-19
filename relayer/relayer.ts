// Relayer: the only party that signs and broadcasts txs, so tx.from on-chain is always a relayer key.
// Holds no user funds, cannot forge intents (Settlement verifies the vault key's EIP-712 signature).
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  numberToHex,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { settlementAbi, tokenAbi } from "../lib/abis";
import type { Intent } from "../lib/intent";
import type { Deployments } from "../script/config";

export interface TxResult {
  hash: Hex;
  ok: boolean;
  gasLimit: bigint;
  sentAt: number; // ms epoch, before broadcast
  confirmedAt: number; // ms epoch, receipt seen
  latencyMs: number;
  broadcastMs: number; // sign done -> RPC accepted (includes retries)
  attempts: number; // broadcast attempts (>1 = RPC pushed back)
  blockNumber: bigint;
}

/** Raw JSON-RPC receipt: only the fields we use. */
interface RawReceipt {
  transactionHash: Hex;
  status: Hex;
  blockNumber: Hex;
}

/** Spaces calls at least 1/perSec apart (shared across concurrent callers). */
class Pacer {
  private next = 0;
  constructor(private perSec: number) {}
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + 1000 / this.perSec;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

export interface Permit {
  owner: Hex;
  amount: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

export class Relayer {
  readonly publicClient: PublicClient;
  /** Coalesces concurrent calls into one JSON-RPC batch (one HTTP request): keeps a burst under the public RPC's rate limit. */
  readonly batchClient: PublicClient;
  private accounts: PrivateKeyAccount[];
  private nextNonce = new Map<string, number>();
  private rr = 0;
  private payGas?: bigint;

  constructor(
    private chain: Chain,
    private rpcUrl: string,
    keys: Hex[],
    private dep: Deployments,
  ) {
    this.accounts = keys.map((k) => privateKeyToAccount(k));
    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 6, retryDelay: 250 }) });
    this.batchClient = createPublicClient({
      chain,
      transport: http(rpcUrl, { batch: { batchSize: 100, wait: 15 }, retryCount: 0 }),
    });
  }

  get addresses() {
    return this.accounts.map((a) => a.address);
  }

  private nonceInit = new Map<string, Promise<void>>();

  /**
   * Every relayer tx MUST go through this manager (including mint): Monad's async execution makes
   * getTransactionCount lag right after a send, so a second nonce source would collide.
   * Init is memoised as a promise so concurrent first callers cannot all read the same nonce.
   */
  private async claimNonce(acc: PrivateKeyAccount): Promise<number> {
    const key = acc.address;
    if (!this.nonceInit.has(key)) {
      this.nonceInit.set(
        key,
        (async () => {
          const [latest, pending] = await Promise.all([
            this.publicClient.getTransactionCount({ address: key, blockTag: "latest" }),
            this.publicClient.getTransactionCount({ address: key, blockTag: "pending" }),
          ]);
          this.nextNonce.set(key, Math.max(latest, pending));
        })(),
      );
    }
    await this.nonceInit.get(key);
    const n = this.nextNonce.get(key)!;
    this.nextNonce.set(key, n + 1); // sync read+increment after the await: safe under concurrency
    return n;
  }

  /** Round-robin across relayer keys so a burst is not serialized behind one account. */
  private pick(): PrivateKeyAccount {
    return this.accounts[this.rr++ % this.accounts.length];
  }

  private gasCache = new Map<string, bigint>();
  private fees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; at: number };

  private async feeCaps() {
    if (!this.fees || Date.now() - this.fees.at > 30_000) {
      const f = await this.publicClient.estimateFeesPerGas();
      // Pay is min(base+priority, max) x gas_limit, but Monad's reserve-balance rule budgets in-flight txs
      // (past 3 blocks) against a 10 MON cap, so keep the cap tight instead of generous.
      this.fees = { maxFeePerGas: (f.maxFeePerGas! * 13n) / 10n, maxPriorityFeePerGas: f.maxPriorityFeePerGas!, at: Date.now() };
    }
    return this.fees;
  }

  /**
   * Sign locally so the tx hash is known before broadcast, then resend the IDENTICAL raw tx on
   * transient RPC errors. Resending is idempotent; "already known / higher priority" after a
   * retry means an earlier attempt landed, so we just confirm by hash instead of failing.
   */
  private async broadcast(raw: Hex): Promise<number> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.pacer.take();
        await this.publicClient.sendRawTransaction({ serializedTransaction: raw });
        return attempt + 1;
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        if (/higher priority|already known|known transaction|already imported|nonce too low/i.test(msg)) return attempt + 1;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  private waiters = new Map<Hex, { resolve: (r: RawReceipt) => void; reject: (e: Error) => void; since: number; deadline: number }>();
  private polling = false;
  private pacer = new Pacer(35); // public RPC allows 50 calls/s, counting each item in a batch; leave room for reads

  /**
   * One shared poller for every in-flight tx, sized for a 50 calls/s RPC budget.
   * Per tick: 1 eth_blockNumber, then 1 eth_getBlockReceipts per NEW block, matched against all pending
   * hashes. Call volume is ~3/s no matter how many txs are in flight (viem's waitForTransactionReceipt
   * is one eth_getTransactionByHash per tx per tick, which is what tripped the 429s).
   * A slow-path eth_getTransactionReceipt covers txs the block scan somehow missed.
   */
  private waitReceipt(hash: Hex, timeoutMs = 60_000): Promise<RawReceipt> {
    return new Promise((resolve, reject) => {
      this.waiters.set(hash, { resolve, reject, since: Date.now(), deadline: Date.now() + timeoutMs });
      void this.pollLoop();
    });
  }

  private async pollLoop() {
    if (this.polling) return;
    this.polling = true;
    let cursor: bigint | undefined;
    let backoff = 0;
    try {
      while (this.waiters.size) {
        await new Promise((r) => setTimeout(r, 120 + backoff));
        try {
          const head = await this.publicClient.getBlockNumber();
          let at: bigint = cursor ?? head - 3n;
          while (at < head && this.waiters.size) {
            const next: bigint = at + 1n;
            const receipts = (await this.publicClient.request({
              method: "eth_getBlockReceipts",
              params: [numberToHex(next)],
            } as never)) as RawReceipt[] | null;
            for (const r of receipts ?? []) {
              const w = this.waiters.get(r.transactionHash);
              if (w) {
                this.waiters.delete(r.transactionHash);
                w.resolve(r);
              }
            }
            at = next;
            cursor = at; // advance only past blocks fully scanned
          }
          // slow path: anything pending for >4s gets a direct lookup (a few per tick)
          const stale = [...this.waiters].filter(([, w]) => Date.now() - w.since > 4000).slice(0, 8);
          for (const [hash, w] of stale) {
            const r = (await this.publicClient.request({
              method: "eth_getTransactionReceipt",
              params: [hash],
            } as never)) as RawReceipt | null;
            if (r) {
              this.waiters.delete(hash);
              w.resolve(r);
            }
          }
          backoff = 0;
        } catch (e) {
          const limited = /429|too many|request limit/i.test(String((e as Error).message ?? e));
          backoff = limited ? Math.min(backoff * 2 || 400, 3000) : 200;
        }
        for (const [hash, w] of this.waiters) {
          if (Date.now() > w.deadline) {
            this.waiters.delete(hash);
            w.reject(new Error(`receipt timeout for ${hash}`));
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async send(
    fn: "payWithInvoice" | "depositWithPermit" | "mint",
    args: readonly unknown[],
    gas: bigint | undefined,
  ): Promise<TxResult> {
    const acc = this.pick();
    const target =
      fn === "mint"
        ? ({ address: this.dep.token, abi: tokenAbi } as const)
        : ({ address: this.dep.settlement, abi: settlementAbi } as const);
    const data = encodeFunctionData({ abi: target.abi, functionName: fn, args } as never);
    if (gas === undefined) {
      const cached = this.gasCache.get(fn);
      if (cached) gas = cached;
      else {
        const est = await this.publicClient.estimateGas({ account: acc, to: target.address, data });
        gas = est + est / 10n;
        this.gasCache.set(fn, gas);
      }
    }
    const nonce = await this.claimNonce(acc);
    const caps = await this.feeCaps();
    const raw = await acc.signTransaction({
      type: "eip1559",
      chainId: this.chain.id,
      to: target.address,
      data,
      value: 0n,
      nonce,
      gas, // Monad charges gas_limit: always an explicit, tight limit
      maxFeePerGas: caps.maxFeePerGas,
      maxPriorityFeePerGas: caps.maxPriorityFeePerGas,
    });
    const hash = keccak256(raw);
    const sentAt = Date.now();
    const attempts = await this.broadcast(raw);
    const broadcastMs = Date.now() - sentAt;
    const receipt = await this.waitReceipt(hash);
    const confirmedAt = Date.now();
    return {
      hash,
      ok: receipt.status === "0x1",
      gasLimit: gas,
      sentAt,
      confirmedAt,
      latencyMs: confirmedAt - sentAt,
      broadcastMs,
      attempts,
      blockNumber: BigInt(receipt.blockNumber),
    };
  }

  /** First call estimates, later calls reuse with a small buffer (cold-access cost is fixed per path). */
  private async payGasLimit(intent: Intent, sig: Hex): Promise<bigint> {
    if (this.payGas) return this.payGas;
    const est = await this.publicClient.estimateContractGas({
      address: this.dep.settlement,
      abi: settlementAbi,
      functionName: "payWithInvoice",
      args: [intent, sig],
      account: this.accounts[0],
    });
    this.payGas = est + est / 10n;
    return this.payGas;
  }

  async submitIntent(intent: Intent, sig: Hex): Promise<TxResult> {
    const gas = await this.payGasLimit(intent, sig);
    return this.send("payWithInvoice", [intent, sig], gas);
  }

  /** Testnet mock token only. Goes through the same nonce manager as everything else. */
  async mint(to: Hex, amount: bigint): Promise<TxResult> {
    return this.send("mint", [to, amount], undefined);
  }

  async depositWithPermit(vaultKey: Hex, p: Permit): Promise<TxResult> {
    return this.send("depositWithPermit", [vaultKey, p.owner, p.amount, p.deadline, p.v, p.r, p.s], undefined);
  }

  /** Fire all intents concurrently. Latency per tx = broadcast to receipt. */
  async burst(items: { intent: Intent; sig: Hex }[]): Promise<TxResult[]> {
    if (items.length) await this.payGasLimit(items[0].intent, items[0].sig); // warm the cached limit once
    return Promise.all(items.map((x) => this.submitIntent(x.intent, x.sig)));
  }
}
