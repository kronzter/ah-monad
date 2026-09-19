import { runVendorAgent } from "../../../agents/vendor";
import { guardedStream } from "../../server/guard";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Streams the agent-to-agent conversation live: one JSON event per line (see ChatEvent in agents/vendor.ts).
export async function POST(req: Request) {
  const { request: raw } = (await req.json().catch(() => ({}))) as { request?: string };
  const request = String(raw ?? "Pay my usual supplier for 200 units.").slice(0, 300);
  return guardedStream("negotiate", 8_000, async (emit) => {
    const s = await getSession();
    s.supplierAgent.accepted = undefined;
    await runVendorAgent(s.vendor, { S1: s.supplierAgent }, request, emit);
  });
}
