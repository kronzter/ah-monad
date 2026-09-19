# Launch kit — Build in Public points

Everything here is a **draft for you to post yourself**. Nothing has been posted. Tag **@monad**, **@monad_dev**,
**@geeky_kartikey** in every post. Posts made after 5:45 PM earn nothing; screenshot each post + its view count
before the deadline.

## Checklist (25 points each)

- [ ] Post about the project on X and/or LinkedIn tagging the three handles
- [ ] Demo video (30 s+, product running) posted on socials
- [ ] Creative ad video posted on socials
- [ ] 5K+ combined views across all posts made during the blitz

## Post 1 — X (main)

> Every on-chain B2B payment leaks your supplier graph to any competitor with a scraper.
>
> We built Shade on @monad: agents pay suppliers at one-time stealth addresses, through one relayer, and the LLM
> never sees supplier identities. Prompt injection gets nothing.
>
> Live tx, decoy bursts, verified contracts 👇
> [live URL] · [repo URL]
>
> @monad_dev @geeky_kartikey #MonadBlitz

## Post 2 — X thread (numbers, all measured)

1. "Built Shade at Monad Blitz Mumbai: a private settlement rail for autonomous agent commerce. 🧵"
2. "Problem: an agent that pays the same supplier wallet weekly hands competitors its supplier graph, volumes and pricing."
3. "Fix: every payment goes to a fresh ERC-5564 stealth address. One relayer submits everything, so `tx.from` never changes."
4. "The LLM only sees `{handle: S1, qty: 200}`. Identities and keys live in plain wallet code. 4 injection attacks, 0 secrets leaked."
5. "Why @monad: a burst of 3 real payments + 50 decoys confirmed 53/53 in seconds; a single payment lands in under a second (median 873 ms)."
6. "Contracts verified on MonadVision + Monadscan: 0xe68c651f7d8e5a3c7cbafac6cc9e02d9ca454e7d. Repo + live demo: [links] @monad_dev @geeky_kartikey"

## Post 3 — LinkedIn

> As AI agents start doing real procurement, public blockchains become a liability: every payment reveals who you
> buy from, how much, and how often. At Monad Blitz Mumbai we built **Shade** — stealth-address settlement for
> agent commerce. One-time recipient addresses, a relayer that hides the sender, and an LLM/wallet split so a
> prompt injection has nothing to leak. Deployed and verified on Monad testnet, with decoy bursts that only make
> sense at Monad's throughput. Repo and live demo: [links]. Thanks @Monad and @geeky_kartikey.
> *(LinkedIn: tag the pages/people through the mention picker.)*

## Demo video (30–60 s, screen recording of the live app)

| t | Shot | Voice-over |
|---|---|---|
| 0–5 s | Shade masthead | "Public chains leak your supplier graph." |
| 5–20 s | Act I: type the request, agent chat bubbles stream in, tx link | "Two agents negotiate. The payment settles live on Monad." |
| 20–35 s | Act II: fire burst, bars grow, ledger fills | "Three real payments hidden among fifty decoys." |
| 35–45 s | Click **Declassify**: 3 rows light up amber | "Only the supplier's key can tell which are theirs." |
| 45–55 s | Act III: injection replies, `0 leaked` stamps | "A prompt injection gets nothing. The model never held the data." |
| 55–60 s | Repo + contract address on screen | "Shade. Built on Monad." |

Record with the OS screen recorder at 1080p; start the burst before recording begins so the relayer is warm.

## Creative ad (15 s)

Black screen, typewriter text: *"Your competitor knows who you buy from."* → block-explorer rows scrolling, all
identical → *"Now they don't."* → three rows glow amber, the rest fade → logo **Shade** + "Private settlement for
agents. On Monad." + repo/URL. Music: low pulse, single hit on the amber reveal.

## Getting to 5K views (honest tactics only)

Post the demo video natively (not as a link) on X, reply to your own post with the repo + live link, quote-post
@monad_dev's blitz announcements with the demo, post the same video on LinkedIn, and share in the blitz group
chats. Views are not something to promise: record the actual counts before 5:45 PM.
