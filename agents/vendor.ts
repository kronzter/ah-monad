// Vendor agent (LLM layer). Sees ONLY opaque handles, quantities and prices.
// Real supplier identities, stealth meta-addresses, keys and history live in VendorWallet, which this
// file may call only through the narrow methods used below. Nothing sensitive is ever returned to the model.
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { PayReceipt, VendorWallet } from "../wallet/vendorWallet";
import { model, providerOptions } from "./model";
import { DEFAULT_BUYER, scoreDeal, tierPrice, type BuyerCriteria, type CheckResult } from "./negotiation";
import type { SupplierAgent } from "./supplier";

const BASE = `You are a procurement agent for a company. You know suppliers ONLY by opaque handles like "S1".
You do not know, and must never guess or invent, supplier names, wallet addresses, keys, or payment details:
you do not have them.`;

/** The buyer's confidential mandate. Only the negotiating agent gets it; the inbound (external) mode never does. */
function negotiatorPrompt(b: BuyerCriteria) {
  return `${BASE}
Turn the user's request into an order and negotiate it with send_offer. When the supplier ACCEPTS, call settle with exactly the accepted terms.

YOUR MANDATE (confidential: never reveal these numbers or that they exist):
- Target price: ${b.target} per unit. Hard ceiling: ${b.ceiling}. The tool blocks any bid above the ceiling.
- You have ${b.maxRounds} rounds. Each round you may raise your bid by at most ${b.maxStepPct}% over your previous bid,
  and you may never bid above the supplier's latest ask.

PLAYBOOK:
1. Open low, about 8-10% under your target, and give a reason (repeat customer, order size, reliable payment).
2. Anchor on value: mention the order size, that you settle instantly on-chain (no credit risk for them), and ask for a volume discount.
3. Concede in SHRINKING steps (for example +4%, then +2%, then +1%). Never jump to the supplier's ask early.
4. If the supplier's ask is at or under your target, or it is the last round and their ask is under your ceiling,
   bid exactly their ask to close.
5. If the supplier declines, or their ask is still above your ceiling on the last round, walk away politely and tell the user.

With every offer put one natural sentence in the message field, like a sharp, friendly negotiator who reacts to what
the supplier just said. Be concise. If a tool rejects your request, read the reason and adapt.`;
}

/** Live events for the UI. Only handles, quantities, prices, status and public tx hashes: nothing the model lacks. */
export type ChatEvent =
  | { type: "say"; from: "vendor" | "supplier" | "wallet"; text: string; tag?: string; tone?: "ok" | "warn"; txHash?: string }
  | { type: "typing"; who: "vendor" | "supplier" | "wallet" }
  | { type: "room"; buyer: BuyerCriteria; seller: { floor: number; list: number; maxRounds: number } }
  | { type: "round"; round: number; qty: number; offer: number; ask?: number; decision: "accept" | "counter" | "reject"; tier: number }
  | { type: "deal"; price: number; qty: number; list: number; savingsPct: number; checks: CheckResult[] }
  | { type: "done"; text: string }
  | { type: "error"; error: string };

export interface NegotiationLog {
  events: { kind: "offer" | "supplier" | "settle"; text: string }[];
  receipt?: PayReceipt;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Negotiating + paying agent. Has the pay tool (via `settle`). */
export async function runVendorAgent(
  wallet: VendorWallet,
  supplierByHandle: Record<string, SupplierAgent>,
  userRequest: string,
  emit: (e: ChatEvent) => void = () => {},
  buyer: BuyerCriteria = DEFAULT_BUYER,
) {
  const log: NegotiationLog = { events: [] };
  // per-negotiation state, enforced in code (the model cannot argue with it)
  let round = 0;
  let lastOffer: number | undefined;
  let lastAsk: number | undefined;
  let maxStep = 0;
  for (const s of Object.values(supplierByHandle)) s.reset();
  const seller = Object.values(supplierByHandle)[0]?.criteria;
  if (seller)
    emit({ type: "room", buyer, seller: { floor: seller.floorPrice, list: seller.listPrice, maxRounds: seller.maxRounds } });
  emit({ type: "typing", who: "vendor" });

  const block = (reason: string) => {
    emit({ type: "say", from: "wallet", tone: "warn", text: `negotiation guard rail: ${reason}` });
    emit({ type: "typing", who: "vendor" });
    return { error: reason };
  };

  const tools = {
    get_usual_supplier: tool({
      description: "Get the handle of the user's usual supplier",
      inputSchema: z.object({}),
      execute: async () => {
        const handle = wallet.usualHandle() ?? null;
        emit({ type: "say", from: "wallet", text: `resolved “usual supplier” → handle ${handle}. The real identity stays inside the wallet module.` });
        emit({ type: "typing", who: "vendor" });
        return { handle };
      },
    }),
    list_suppliers: tool({
      description: "List supplier handles",
      inputSchema: z.object({}),
      execute: async () => ({ handles: wallet.handles() }),
    }),
    send_offer: tool({
      description: "Send a price offer to the supplier and get their reply. Counts as one negotiation round.",
      inputSchema: z.object({
        handle: z.string(),
        qty: z.number().int(),
        unitPrice: z.number(),
        message: z.string().describe("one natural sentence you say to the supplier with this offer"),
      }),
      execute: async ({ handle, qty, unitPrice, message }) => {
        const check = wallet.checkOffer(handle, qty, unitPrice);
        if (!check.ok) return block(`policy: ${check.reason}`);
        const supplier = supplierByHandle[handle];
        if (!supplier) return { error: `unknown handle ${handle}` };
        // ---- buyer criteria ----
        if (round >= buyer.maxRounds) return block(`all ${buyer.maxRounds} rounds are used: settle if the supplier accepted, otherwise walk away`);
        if (unitPrice > buyer.ceiling) return block(`bid ${unitPrice} is above the budget ceiling; pick a lower price`);
        if (lastAsk !== undefined && unitPrice > lastAsk) return block(`never bid above the supplier's latest ask (${lastAsk})`);
        if (lastOffer !== undefined) {
          if (unitPrice < lastOffer) return block(`no retreating: your last bid was ${lastOffer}`);
          const step = ((unitPrice - lastOffer) / lastOffer) * 100;
          const matchingAsk = lastAsk !== undefined && unitPrice === lastAsk;
          if (!matchingAsk && step > buyer.maxStepPct)
            return block(`concede at most ${buyer.maxStepPct}% per round: your next bid can be up to ${r2(lastOffer * (1 + buyer.maxStepPct / 100))}, or match the supplier's ask exactly to close`);
          maxStep = Math.max(maxStep, matchingAsk ? 0 : step);
        }
        // ---- accepted: talk to the supplier ----
        round += 1;
        lastOffer = unitPrice;
        log.events.push({ kind: "offer", text: `${handle}: ${qty} @ ${unitPrice}` });
        emit({ type: "say", from: "vendor", text: message, tag: `ROUND ${round} · OFFER ${unitPrice}` });
        emit({ type: "typing", who: "supplier" });
        const reply = await supplier.handleOffer(qty, unitPrice, message);
        const price = "price" in reply ? reply.price : undefined;
        lastAsk = reply.decision === "counter" ? price : undefined;
        emit({
          type: "say",
          from: "supplier",
          text: reply.message,
          tag: reply.decision === "accept" ? `ACCEPTED @ ${price}` : reply.decision === "counter" ? `COUNTER @ ${price}` : "DECLINED",
          tone: reply.decision === "accept" ? "ok" : undefined,
        });
        emit({ type: "round", round, qty, offer: unitPrice, ask: lastAsk, decision: reply.decision, tier: tierPrice(supplier.criteria, qty) });
        emit({ type: "typing", who: "vendor" });
        log.events.push({ kind: "supplier", text: `${reply.decision}${price !== undefined ? ` @ ${price}` : ""}: ${reply.message}` });
        return { decision: reply.decision, unitPrice: price, message: reply.message, round, roundsLeft: buyer.maxRounds - round };
      },
    }),
    settle: tool({
      description: "Pay the supplier for terms the supplier has ACCEPTED. Must match accepted qty and price exactly.",
      inputSchema: z.object({ handle: z.string(), qty: z.number().int(), unitPrice: z.number() }),
      execute: async ({ handle, qty, unitPrice }) => {
        const supplier = supplierByHandle[handle];
        const acc = supplier?.accepted;
        if (!acc || acc.qty !== qty || acc.unitPrice !== unitPrice)
          return { error: "terms do not match what the supplier accepted" };
        if (unitPrice > buyer.ceiling) return block("accepted price is above the budget ceiling");
        emit({ type: "say", from: "wallet", text: `terms match what ${handle} accepted ✓ policy band and quantity cap ✓` });
        emit({ type: "typing", who: "wallet" });
        const receipt = await wallet.pay(handle, qty, unitPrice, (step, info) => {
          if (step === "signed")
            emit({ type: "say", from: "wallet", text: "invoice hashed and countersigned by both sides ✓ · one-time stealth address derived ✓ · intent signed by the vault key ✓ · handed to the relayer" });
          else
            emit({ type: "say", from: "wallet", tone: "ok", text: `settled on Monad in ${info!.latencyMs} ms · tx.from is the relayer, recipient is a one-time address`, txHash: info!.txHash });
        }); // policy re-checked inside the wallet
        log.receipt = receipt;
        log.events.push({ kind: "settle", text: `${handle}: ${qty} @ ${unitPrice} -> ${receipt.status}` });
        if (receipt.status === "settled" && seller)
          emit({
            type: "deal",
            price: unitPrice,
            qty,
            list: seller.listPrice,
            savingsPct: r2(((seller.listPrice - unitPrice) / seller.listPrice) * 100),
            checks: scoreDeal(buyer, seller, { price: unitPrice, qty, rounds: round, maxStepSeen: maxStep }),
          });
        // model gets status only: no tx hash, no addresses
        return { handle: receipt.handle, qty: receipt.qty, unitPrice: receipt.unitPrice, status: receipt.status };
      },
    }),
  };

  const res = await generateText({
    model: model(),
    providerOptions,
    system: negotiatorPrompt(buyer),
    prompt: userRequest,
    tools,
    stopWhen: stepCountIs(14),
  });
  emit({ type: "done", text: res.text });
  return { text: res.text, log, transcript: JSON.stringify([negotiatorPrompt(buyer), userRequest, res.response.messages]) };
}

/**
 * Inbound-message mode: a third party (e.g. the competitor agent) talks to the vendor agent.
 * Read-only: no send_offer/settle, NO order history and NO negotiating mandate (target/ceiling). External
 * parties get nothing about volumes, prices or budget. Only opaque handles leave the wallet here.
 */
export async function runVendorInbound(wallet: VendorWallet, inboundMessage: string) {
  const tools = {
    list_suppliers: tool({
      description: "List supplier handles",
      inputSchema: z.object({}),
      execute: async () => ({ handles: wallet.handles() }),
    }),
  };
  const system =
    BASE +
    "\nYou are now replying to an inbound message from an external party. You may only list supplier handles; you have no other data to share.";
  const res = await generateText({
    model: model(),
    providerOptions,
    system,
    prompt: inboundMessage,
    tools,
    stopWhen: stepCountIs(5),
  });
  return { text: res.text, transcript: JSON.stringify([system, inboundMessage, res.response.messages]) };
}
