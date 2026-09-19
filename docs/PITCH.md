# Shade — pitch script (3 minutes) + judge cheat-sheet

## Say these four things out loud (Basic Points)

1. **Repo:** github.com/kronzter/ah-monad (public, README has run steps)
2. **Contract:** Settlement `0xe68c651f7d8e5a3c7cbafac6cc9e02d9ca454e7d` on Monad testnet, source verified on MonadVision and Monadscan
3. **Live URL:** *(fill in after deploy)*
4. **Deployment:** contracts on Monad testnet (chain 10143); app hosted publicly

## Script

**0:00 — Problem (20s).** "Agents will do B2B procurement. On a public chain, a procurement agent that pays the
same supplier wallet every week hands every competitor its supplier graph, volumes and pricing. Agents make it
worse: they transact more often and more mechanically than people, so the trail is cleaner to mine."

**0:20 — Idea (30s).** "Shade is a stealth-address settlement rail. Every payment goes to a fresh one-time address.
One relayer submits everything, so `tx.from` never changes. And the LLM never holds the sensitive data: it only sees
handles like S1 and quantities. Real supplier identities and keys live in plain code the model can't touch."

**0:50 — Live demo (75s).**
- **Act I** — click *Start the conversation*: the two agents chat live. "Pay my usual supplier for 200 units." Two LLM agents haggle over up to four rounds under enforced criteria (the deal room charts
  bids converging, our runs closed near 9.99 against a list of 12), the supplier accepts, both sign the invoice, the payment settles **live on Monad**. Point at the tx link.
- **Act II** — *Fire burst*. "Three real payments hidden among fifty decoys, fired concurrently, all confirmed."
  Open the ledger: **one sender, dozens of unrelated recipients.** Click **Declassify with supplier key**: only the
  supplier's view key can prove which three are theirs.
- **Act III** — *Run injection*. "A competitor agent tries to make our agent leak the supplier list." Show the
  replies: it only ever says `S1`. "0 secrets leaked, because the model never held them."

**2:05 — Why Monad (25s).** "Stealth payments work on any EVM chain. What is Monad-specific is the anonymity set:
decoys only hide real payments if you can fire dozens of them at once and settle them fast. A single payment
confirms in under a second here (median 873 ms); a burst of 53 lands in a few seconds."

**2:30 — Business (20s).** "Per-enterprise subscription or a basis-point fee on settled volume through the relayer.
Wedge: agent-to-agent vendor payments. Upsell: a KYC-gated shielded pool with viewing-key audit export — hide
payments from competitors, give regulators a better audit trail than a public ledger."

**2:50 — Honest limits (10s).** "Amounts are still public, the vault key is a pseudonym, the relayer is trusted for
liveness. Decoys blur, they don't eliminate; the shielded pool is the real fix. It's in the README."

## Judge Q&A

- **"Isn't the sender visible?"** `tx.from` is the relayer and the token Transfer is vault → one-time address. The
  vault key is recoverable from the intent signature in calldata, so it's a pseudonym; the deposit links a treasury
  to it once. Pooling and the shielded pool are the roadmap.
- **"Can't amounts fingerprint a supplier?"** Partly, yes. Decoys draw amounts from the same range; fixed
  denominations are on the roadmap. We say so up front.
- **"What stops the agent paying an attacker?"** Policy runs in wallet code: known handles only, price band,
  quantity cap, and `settle` only pays terms the supplier agent actually accepted. Tool-abuse red-teaming with a
  payment-holding agent is future work; the demo attack is data exfiltration only.
- **"Why is burst latency seconds, not sub-second?"** Single payments are sub-second. The burst runs through a
  shared public RPC capped at 50 calls/s; we measured it and built a block-receipt poller and paced broadcasts.
  A private RPC is the fix.
- **"Who pays?"** Enterprises pay a subscription or a take rate; the relayer is the revenue point.
- **"Is it audited / mainnet?"** No. Testnet, mock token, unaudited.

## Bonus-point angles

- **Product-market fit:** procurement teams and finance ops already fear on-chain transparency; agents amplify it.
- **Revenue:** take rate on settled volume + enterprise subscription; compliance pool upsell.
- **Innovation:** LLM/wallet split as a structural prompt-injection defense, plus decoy-based anonymity sets
  that only make sense at Monad throughput.
