# Shade — private settlement rail for autonomous agent commerce

> As AI agents start doing real B2B procurement, every payment on a public chain leaks your supplier graph,
> order volumes and pricing to any competitor running a scraper. **Shade** pays every supplier at a fresh
> one-time stealth address, submits everything through one relayer, and keeps supplier identities out of the
> LLM entirely — on Monad, where the throughput makes decoy traffic practical.

| | |
|---|---|
| **Live demo** | `LIVE_URL` <!-- replace with the hosted URL --> |
| **Repo** | https://github.com/kronzter/ah-monad |
| **Network** | Monad Testnet (chain id `10143`) |
| **Contracts** | verified on MonadVision and Monadscan (table below) |

## Deployed contracts (Monad Testnet, source verified)

| Contract | Address | Explorers |
|---|---|---|
| `Settlement` | `0xe68c651f7d8e5a3c7cbafac6cc9e02d9ca454e7d` | [MonadVision](https://testnet.monadvision.com/address/0xe68c651f7d8e5a3c7cbafac6cc9e02d9ca454e7d) · [Monadscan](https://testnet.monadscan.com/address/0xe68c651f7d8e5a3c7cbafac6cc9e02d9ca454e7d) |
| `StealthAnnouncer` (ERC-5564) | `0x41130b9916228b21e928bb582dd23cd20f630113` | [MonadVision](https://testnet.monadvision.com/address/0x41130b9916228b21e928bb582dd23cd20f630113) · [Monadscan](https://testnet.monadscan.com/address/0x41130b9916228b21e928bb582dd23cd20f630113) |
| `MockPermitToken` (sUSD, open mint, EIP-2612) | `0xed8ced876c7ecbf600d5b802b64af5682fdb9962` | [MonadVision](https://testnet.monadvision.com/address/0xed8ced876c7ecbf600d5b802b64af5682fdb9962) · [Monadscan](https://testnet.monadscan.com/address/0xed8ced876c7ecbf600d5b802b64af5682fdb9962) |

Addresses are also in [`deployments/monad-testnet.json`](deployments/monad-testnet.json).

## What it does

1. **Stealth addresses.** Every payment goes to a fresh ERC-5564-style one-time address derived from the
   supplier's stealth meta-address. Two payments to the same supplier never look connected on-chain.
2. **Vault + relayer hide the sender.** A vendor deposits once under a pseudonymous vault key. Each payment is an
   EIP-712 signed intent that a single relayer submits and pays gas for, so `tx.from` is always the relayer and
   the token `Transfer` is `Settlement → one-time address` (never the payer). The relayer cannot forge intents.
3. **The LLM never holds the sensitive data.** The vendor and supplier agents (LLMs) only see opaque handles,
   quantities and prices (`{handle: "S1", qty: 200}`). Supplier identities, meta-addresses, keys and payment
   history live in plain wallet code the model cannot reach, so a prompt injection has nothing to exfiltrate.
   Policy (known handles, price band, quantity cap, "pay only what the supplier accepted") is enforced in code.
4. **Negotiation runs on explicit criteria, enforced in code.** The supplier's pricing engine (volume tiers, a
   confidential margin floor, a scheduled concession curve, a 2% instant-on-chain-settlement lever, a round limit)
   decides accept / counter / reject and the numbers; the LLM only voices it. The buyer agent has a target, a hard
   ceiling, a max concession per round and a never-bid-above-their-ask rule, blocked by the tool, not by hope. The
   UI's deal room charts bids and asks converging and scores the deal against every criterion.
5. **Payments bind to invoices.** The agreed invoice (qty, unit price, total, terms, nonce — no identities) is
   hashed; both parties sign it off-chain; only the hash goes on-chain (`invoices[hash]`), so an auditor can
   later reveal the JSON to prove a payment matches an agreement.
6. **Monad throughput makes decoys real.** Decoys are full fake payments through the same code path (random
   recipient, random invoice, in-range amount) fired concurrently with real ones. Real and decoy logs are
   identical, so a scraper sees one relayer paying strangers.

```
 user ─NL─► Vendor agent (LLM: handles/qty/price only) ◄──► Supplier agent (LLM: own price sheet only)
                 │ tool call: settle(handle, qty, price)         │ accepts terms
                 ▼                                               ▼
        VendorWallet (plain code)                         SupplierWallet (plain code)
   registry · keys · policy · history                  view/spend keys · scan · countersign
                 │ signed EIP-712 intent                         ▲ finds its payments by view tag
                 ▼                                               │
              Relayer ── one tx.from, pays gas ──►  Settlement ─► StealthAnnouncer (ERC-5564 events)
                                                    vault → one-time address
```

## Try it (≈5 minutes, uses the contracts already deployed)

Requirements: Node 20+, [pnpm](https://pnpm.io), [Foundry](https://getfoundry.sh) (only for contract tests),
a Monad **testnet** key with some MON (faucets: see the [Monad docs](https://docs.monad.xyz)), and an LLM key (DeepSeek by default).

```bash
git clone https://github.com/kronzter/ah-monad && cd ah-monad
pnpm install
cp .env.example .env        # set RELAYER_PKS (funded testnet key, >10 MON) and DEEPSEEK_API_KEY
pnpm dev                    # http://localhost:3000
```

In the UI: **I. Start the conversation** (two LLM agents haggle live in a chat, then settle on-chain) → **II. Fire burst** (3 real payments among
decoys) → **III. Run injection** (competitor tries to extract the supplier graph) → **Declassify with supplier key**
in the ledger to see which rows only the supplier's view key can prove.

No UI? `pnpm demo:agents` runs negotiation + payment + supplier scan + injection in the terminal;
`pnpm demo` runs the decoy burst; `pnpm latency` measures single-payment latency.

Checks: `pnpm test:contracts` (8 Foundry tests), `pnpm test` (stealth crypto), `pnpm typecheck`, `pnpm build`.

Deploy your own copy: `pnpm build:contracts && NETWORK=monad-testnet pnpm deploy:contracts`, then
`pnpm verify:contracts` (publishes source to MonadVision and Monadscan through Monad's verification API).

## Deploy to Vercel (CLI)

```bash
npm i -g vercel@latest && vercel login
pnpm vercel:setup     # link the folder to a Vercel project
pnpm vercel:env       # copies NETWORK, RELAYER_PKS, DEEPSEEK_*, DEMO_SEED (and optional RPC_URL) from .env to production
pnpm deploy:vercel    # production deploy, prints the URL
```

`DEMO_SEED` must be set on Vercel: it makes the supplier and vault identities identical on every serverless
instance. The relayer key you set there pays testnet gas for anyone using the public demo, so use a
dedicated testnet-only key. Expensive routes are rate-limited and refuse bursts if the relayer drops below
`MIN_RELAYER_MON`.

## Measured results (Monad testnet)

| What | Result |
|---|---|
| One payment sent alone (send → receipt, 8 runs) | 364–978 ms, median 873 ms |
| Burst: 3 real + 50 decoys, one sender | 53/53 confirmed, all landed in 4–7 s across ~10 blocks |
| Burst per-tx latency | median 2.7–3.8 s: bounded by the shared public RPC (50 calls/s), not the chain |
| Ledger after a burst | 1 distinct `tx.from`, one-time recipients only; supplier view key proves only its own payments |
| Prompt injection (4 payloads, full context scanned) | 0 secret markers leaked |

Single payments are sub-second. Burst latency through a shared public RPC is not; a private RPC (`RPC_URL`)
improves it. We report both because the anonymity-set argument depends on volume, and we would rather show the
real numbers.

## Honest limits

- **Amounts are public.** Decoys draw amounts from the same range as real payments, which blurs price×quantity
  fingerprints but does not remove them. Fixed-denomination payouts are on the roadmap.
- **The vault key is a pseudonym, not anonymity.** The intent signature is in calldata, so the vault key is
  recoverable and the initial deposit links a treasury to it once. The real fix is the shielded pool (roadmap).
- **The relayer is trusted for liveness and censorship, not custody:** it cannot forge intents or move vault funds.
- **Supplier sweeps** go into a pseudonymous supplier vault key, not a known wallet, because sweeping to a known
  wallet would link the payment to the supplier and undo the stealth address.
- This is a testnet demo with a mock token. Not audited.

## Roadmap

KYC-gated fixed-denomination shielded pool for large transfers · viewing-key audit export for regulators ·
multi-relayer / private-RPC deployment · tool-abuse hardening tests for agents that hold payment authority.

## Repo layout

```
contracts/   Foundry: Settlement, StealthAnnouncer, MockPermitToken + tests
lib/         ERC-5564 stealth crypto, EIP-712 intents, invoices, permits, chunked log reads
wallet/      VendorWallet / SupplierWallet: registry, keys, policy, history (no LLM imports)
relayer/     nonce manager, paced broadcast, shared receipt poller, decoy bursts
agents/      vendor / supplier / competitor agents (Vercel AI SDK, tool calling)
app/         Next.js UI + API routes (negotiate, burst, attack, ledger)
script/      deploy, verify, demos
deployments/ committed Monad testnet addresses
docs/        pitch script and launch kit
```

Built for Monad Blitz Mumbai V4. Scaffolded with monskills (see `.monskills`).
