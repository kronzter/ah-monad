// Supplier agent (LLM layer). The pricing engine (agents/negotiation.ts) decides accept / counter / reject and
// the numbers; the LLM only turns that decision into a natural reply. It never sees the vendor's identity,
// wallet or keys, and cannot move funds.
import { generateText, tool } from "ai";
import { z } from "zod";
import { decideSeller, type SellerCriteria, type SellerDecision } from "./negotiation";
import { model, providerOptions } from "./model";

export type SupplierReply = SellerDecision & { message: string; ask?: number; round: number };

const respondSchema = z.object({ message: z.string().describe("your reply to the buyer, one or two short sentences") });

export class SupplierAgent {
  private thread: { role: "user" | "assistant"; content: string }[] = [];
  private round = 0;
  /** Last terms this agent accepted, so the supplier wallet can verify the invoice against them. */
  accepted?: { qty: number; unitPrice: number };

  constructor(readonly criteria: SellerCriteria) {}

  /** Start a fresh negotiation (the instance is long-lived on the server). */
  reset() {
    this.thread = [];
    this.round = 0;
    this.accepted = undefined;
  }

  async handleOffer(qty: number, unitPrice: number, buyerMessage?: string): Promise<SupplierReply> {
    this.round += 1;
    const d = decideSeller(this.criteria, qty, unitPrice, this.round);
    const verdict =
      d.decision === "accept"
        ? `ACCEPT the buyer's offer of ${unitPrice} per unit for ${qty} units.`
        : d.decision === "counter"
          ? `COUNTER at ${d.price} per unit for ${qty} units (the buyer offered ${unitPrice}).`
          : `DECLINE the order.`;
    this.thread.push({
      role: "user",
      content: `Round ${this.round} of ${this.criteria.maxRounds}. Buyer says: "${buyerMessage ?? ""}" and offers ${qty} units at ${unitPrice} per unit.\nYour pricing engine's decision: ${verdict}\nReasons you may cite (truthfully): ${d.reasons.join("; ")}.`,
    });
    const res = await generateText({
      model: model(),
      providerOptions,
      system: this.system(),
      messages: this.thread,
      tools: { respond: tool({ description: "Reply to the buyer", inputSchema: respondSchema }) },
      toolChoice: { type: "tool", toolName: "respond" },
    });
    const call = res.toolCalls.find((c) => c.toolName === "respond");
    const message = respondSchema.parse(call?.input ?? { message: "Let me get back to you on that." }).message;
    this.thread.push({ role: "assistant", content: message });
    if (d.decision === "accept") this.accepted = { qty, unitPrice: d.price };
    return { ...d, message, round: this.round, ask: d.decision === "counter" ? d.price : undefined };
  }

  private system() {
    return `You are a friendly, experienced sales rep at a fastener supplier, talking to a buyer's procurement agent.
Your pricing engine has ALREADY decided how to respond each round. Your job is only to put that decision into words:
- Use exactly the numbers in the decision. Never invent, change or round them, and never offer a different price.
- Never mention your floor price, margin or cost, and never say "the engine decided".
- Cite the listed reasons naturally (volume tier, immediate on-chain settlement, closing the deal) and respond to what the buyer just said.
- Sound like a person: warm, brief, a little playful when haggling. One or two short sentences.
Reply ONLY by calling the respond tool.`;
  }
}
