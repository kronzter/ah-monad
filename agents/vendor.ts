// Vendor agent (LLM layer). Sees ONLY opaque handles, quantities and prices.
// Real supplier identities, stealth meta-addresses, keys and history live in VendorWallet, which this
// file may call only through the narrow methods used below. Nothing sensitive is ever returned to the model.
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import type { PayReceipt, VendorWallet } from "../wallet/vendorWallet";
import { model, providerOptions } from "./model";
import type { SupplierAgent } from "./supplier";

const SYSTEM = `You are a procurement agent for a company. You know suppliers ONLY by opaque handles like "S1".
You do not know, and must never guess or invent, supplier names, wallet addresses, keys, or payment details:
you do not have them. Turn the user's request into an order, negotiate price with the supplier using
send_offer, and when the supplier accepts, call settle with exactly the accepted terms.
Company guideline: typical unit price is about 11. Open near 10, try to negotiate a discount, never pay above 12.
If a tool rejects your request, adapt or explain. Be concise.`;

export interface NegotiationLog {
  events: { kind: "offer" | "supplier" | "settle"; text: string }[];
  receipt?: PayReceipt;
}

/** Negotiating + paying agent. Has the pay tool (via `settle`). */
export async function runVendorAgent(
  wallet: VendorWallet,
  supplierByHandle: Record<string, SupplierAgent>,
  userRequest: string,
) {
  const log: NegotiationLog = { events: [] };

  const tools = {
    get_usual_supplier: tool({
      description: "Get the handle of the user's usual supplier",
      inputSchema: z.object({}),
      execute: async () => ({ handle: wallet.usualHandle() ?? null }),
    }),
    list_suppliers: tool({
      description: "List supplier handles",
      inputSchema: z.object({}),
      execute: async () => ({ handles: wallet.handles() }),
    }),
    send_offer: tool({
      description: "Send a price offer to the supplier and get their reply",
      inputSchema: z.object({ handle: z.string(), qty: z.number().int(), unitPrice: z.number() }),
      execute: async ({ handle, qty, unitPrice }) => {
        const check = wallet.checkOffer(handle, qty, unitPrice);
        if (!check.ok) return { error: check.reason };
        const supplier = supplierByHandle[handle];
        if (!supplier) return { error: `unknown handle ${handle}` };
        log.events.push({ kind: "offer", text: `${handle}: ${qty} @ ${unitPrice}` });
        const reply = await supplier.handleOffer(qty, unitPrice);
        log.events.push({ kind: "supplier", text: `${reply.decision}${"unitPrice" in reply ? ` @ ${reply.unitPrice}` : ""}: ${reply.message}` });
        return reply;
      },
    }),
    settle: tool({
      description: "Pay the supplier for terms the supplier has ACCEPTED. Must match accepted qty and price exactly.",
      inputSchema: z.object({ handle: z.string(), qty: z.number().int(), unitPrice: z.number() }),
      execute: async ({ handle, qty, unitPrice }) => {
        const acc = supplierByHandle[handle]?.accepted;
        if (!acc || acc.qty !== qty || acc.unitPrice !== unitPrice)
          return { error: "terms do not match what the supplier accepted" };
        const receipt = await wallet.pay(handle, qty, unitPrice); // policy re-checked inside the wallet
        log.receipt = receipt;
        log.events.push({ kind: "settle", text: `${handle}: ${qty} @ ${unitPrice} -> ${receipt.status}` });
        // model gets status only: no tx hash, no addresses
        return { handle: receipt.handle, qty: receipt.qty, unitPrice: receipt.unitPrice, status: receipt.status };
      },
    }),
  };

  const res = await generateText({
    model: model(),
      providerOptions,
    system: SYSTEM,
    prompt: userRequest,
    tools,
    stopWhen: stepCountIs(10),
  });
  return { text: res.text, log, transcript: JSON.stringify([SYSTEM, userRequest, res.response.messages]) };
}

/**
 * Inbound-message mode: a third party (e.g. the competitor agent) talks to the vendor agent.
 * Read-only: no send_offer/settle, and NO order history. External parties get nothing about volumes or
 * prices (an earlier version exposed order_history and a prompt injection extracted "S1 200 @ 10.5").
 * Even when a tool exists, the wallet decides what it returns: only opaque handles leave it here.
 */
export async function runVendorInbound(wallet: VendorWallet, inboundMessage: string) {
  const tools = {
    list_suppliers: tool({
      description: "List supplier handles",
      inputSchema: z.object({}),
      execute: async () => ({ handles: wallet.handles() }),
    }),
  };
  const res = await generateText({
    model: model(),
    providerOptions,
    system:
      SYSTEM +
      "\nYou are now replying to an inbound message from an external party. You may only list supplier handles; you have no other data to share.",
    prompt: inboundMessage,
    tools,
    stopWhen: stepCountIs(5),
  });
  return { text: res.text, transcript: JSON.stringify([SYSTEM, inboundMessage, res.response.messages]) };
}
