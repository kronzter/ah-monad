import { NextResponse } from "next/server";
import { guarded } from "../../server/guard";
import { runVendorAgent } from "../../../agents/vendor";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  return guarded("negotiate", 8_000, async () => {
    const { request: raw } = (await req.json()) as { request: string };
    const request = String(raw ?? "").slice(0, 300);
    const s = await getSession();
    s.supplierAgent.accepted = undefined;
    const { text, log } = await runVendorAgent(s.vendor, { S1: s.supplierAgent }, request);
    return NextResponse.json({
      text,
      events: log.events,
      receipt: log.receipt ?? null,
      accepted: s.supplierAgent.accepted ?? null,
    });
  });
}
