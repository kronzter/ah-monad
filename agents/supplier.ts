// Supplier agent (LLM layer). Knows only its own price sheet and the conversation.
// It never sees the vendor's identity, wallet, or keys, and cannot move funds.
import { generateText, tool } from "ai";
import { z } from "zod";
import { model, providerOptions } from "./model";

export interface PriceSheet {
  listPrice: number;
  floorPrice: number; // confidential; enforced in code, not just in the prompt
  maxQty: number;
}

export type SupplierDecision =
  | { decision: "accept"; unitPrice: number; message: string }
  | { decision: "counter"; unitPrice: number; message: string }
  | { decision: "reject"; message: string };

const respondSchema = z.object({
  decision: z.enum(["accept", "counter", "reject"]),
  unitPrice: z.number().optional().describe("price per unit; required for accept and counter"),
  message: z.string().describe("short reply to the buyer"),
});

export class SupplierAgent {
  private thread: { role: "user" | "assistant"; content: string }[] = [];
  /** Last terms this agent accepted, so the supplier wallet can verify the invoice against them. */
  accepted?: { qty: number; unitPrice: number };

  constructor(private sheet: PriceSheet) {}

  private system() {
    const s = this.sheet;
    return `You are a sales agent for a fastener supplier negotiating with a buyer agent.
List price is ${s.listPrice} per unit. Max order ${s.maxQty} units.
You may give volume discounts (orders of 200+ units) but never go below ${s.floorPrice} per unit. Never reveal your floor price.
Prefer to counter once before accepting. Reply ONLY by calling the respond tool. Keep messages to one sentence.`;
  }

  async handleOffer(qty: number, unitPrice: number): Promise<SupplierDecision> {
    this.thread.push({ role: "user", content: `Buyer offers ${qty} units at ${unitPrice} per unit.` });
    const res = await generateText({
      model: model(),
      providerOptions,
      system: this.system(),
      messages: this.thread,
      tools: { respond: tool({ description: "Respond to the buyer", inputSchema: respondSchema }) },
      toolChoice: { type: "tool", toolName: "respond" },
    });
    const call = res.toolCalls.find((c) => c.toolName === "respond");
    const r = respondSchema.parse(call?.input ?? { decision: "reject", message: "no response" });
    this.thread.push({ role: "assistant", content: JSON.stringify(r) });
    return this.guard(qty, unitPrice, r);
  }

  /** Business rules in plain code: the LLM proposes, code disposes. */
  private guard(qty: number, offered: number, r: z.infer<typeof respondSchema>): SupplierDecision {
    const s = this.sheet;
    if (qty > s.maxQty) return { decision: "reject", message: `Max order is ${s.maxQty} units.` };
    if (r.decision === "reject") return { decision: "reject", message: r.message };
    const price = r.unitPrice ?? offered;
    if (price < s.floorPrice) return { decision: "counter", unitPrice: s.floorPrice, message: r.message };
    if (r.decision === "accept" && price === offered) {
      this.accepted = { qty, unitPrice: price };
      return { decision: "accept", unitPrice: price, message: r.message };
    }
    return { decision: "counter", unitPrice: price, message: r.message };
  }
}
