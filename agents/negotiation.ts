// Negotiation criteria. Plain code, no LLM: the pricing engine and the buyer's guard rails live here.
// The LLMs supply strategy and wording; these rules decide what is actually allowed and what the numbers are.

export interface SellerCriteria {
  listPrice: number;
  floorPrice: number; // confidential margin floor: never sold below
  tiers: { minQty: number; pct: number }[]; // volume discounts off list
  instantSettlePct: number; // discount offered as a lever for immediate on-chain settlement
  concessionRate: number; // share of the (opening - floor) gap conceded per round
  maxQty: number;
  maxRounds: number;
}

export interface BuyerCriteria {
  target: number; // price the buyer is happy with
  ceiling: number; // hard limit: never bid or pay above
  maxRounds: number;
  maxStepPct: number; // max concession per round, as % of the previous bid
}

export const DEFAULT_SELLER: SellerCriteria = {
  listPrice: 12,
  floorPrice: 9.9,
  tiers: [
    { minQty: 100, pct: 4 },
    { minQty: 200, pct: 9 },
    { minQty: 400, pct: 13 },
  ],
  instantSettlePct: 2,
  concessionRate: 0.35,
  maxQty: 500,
  maxRounds: 4,
};

export const DEFAULT_BUYER: BuyerCriteria = { target: 10.2, ceiling: 11.2, maxRounds: 4, maxStepPct: 5 };

const r2 = (n: number) => Math.round(n * 100) / 100;

export const tierPct = (c: SellerCriteria, qty: number) =>
  c.tiers.filter((t) => qty >= t.minQty).reduce((m, t) => Math.max(m, t.pct), 0);

/** Volume-tier price before any settlement lever. */
export const tierPrice = (c: SellerCriteria, qty: number) => r2(c.listPrice * (1 - tierPct(c, qty) / 100));

/** The seller's scheduled ask for a round: tier price, minus the settlement lever from round 2, minus scheduled concessions. */
export function askForRound(c: SellerCriteria, qty: number, round: number): number {
  const open = tierPrice(c, qty);
  const lever = round >= 2 ? open * (c.instantSettlePct / 100) : 0;
  const conceded = (open - c.floorPrice) * c.concessionRate * (round - 1);
  return r2(Math.max(c.floorPrice, open - lever - conceded));
}

export type SellerDecision =
  | { decision: "accept"; price: number; reasons: string[] }
  | { decision: "counter"; price: number; reasons: string[] }
  | { decision: "reject"; reasons: string[] };

/** Deterministic supplier decision for the buyer's offer in this round. */
export function decideSeller(c: SellerCriteria, qty: number, offer: number, round: number): SellerDecision {
  if (qty > c.maxQty) return { decision: "reject", reasons: [`orders are capped at ${c.maxQty} units`] };
  const ask = askForRound(c, qty, round);
  const volume = tierPct(c, qty) > 0 ? `${qty}-unit volume tier (${tierPct(c, qty)}% off list)` : "standard list pricing";
  const reasons = [volume];
  if (round >= 2) reasons.push(`${c.instantSettlePct}% off for immediate on-chain settlement (no credit risk)`);
  if (offer >= c.floorPrice && offer >= ask * 0.985) return { decision: "accept", price: offer, reasons };
  if (round >= c.maxRounds) {
    return offer >= c.floorPrice
      ? { decision: "accept", price: offer, reasons: ["final round"] }
      : { decision: "reject", reasons: ["final round and the offer is below what we can do"] };
  }
  if (offer < c.floorPrice * 0.9) reasons.push("the offer is far below what we can do");
  if (round === c.maxRounds - 1) reasons.push("this is close to our best price");
  return { decision: "counter", price: ask, reasons };
}

export interface CheckResult {
  ok: boolean;
  label: string;
}

/** End-of-deal scoreboard, computed in code from the actual numbers. */
export function scoreDeal(
  buyer: BuyerCriteria,
  seller: SellerCriteria,
  d: { price: number; qty: number; rounds: number; maxStepSeen: number },
): CheckResult[] {
  const tier = tierPrice(seller, d.qty);
  return [
    { ok: d.price <= buyer.ceiling, label: `at or under the buyer's ceiling (${d.price} ≤ ${buyer.ceiling})` },
    { ok: d.price <= buyer.target, label: `at or under the buyer's target (${d.price} vs ${buyer.target})` },
    { ok: d.price >= seller.floorPrice, label: `seller margin protected (${d.price} ≥ floor ${seller.floorPrice})` },
    { ok: d.price <= tier, label: `volume tier honored (${d.qty} units → ${tier} or better)` },
    { ok: d.maxStepSeen <= buyer.maxStepPct + 0.01, label: `buyer conceded gradually (largest step ${d.maxStepSeen.toFixed(1)}% ≤ ${buyer.maxStepPct}%)` },
    { ok: d.rounds <= buyer.maxRounds, label: `closed in ${d.rounds} of ${buyer.maxRounds} rounds` },
  ];
}
