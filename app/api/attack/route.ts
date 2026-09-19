import { NextResponse } from "next/server";
import { guarded } from "../../server/guard";
import { runInjectionAttack } from "../../../agents/competitor";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  return guarded("attack", 15_000, async () => {
    const s = await getSession();
    const results = await runInjectionAttack(s.vendor);
    return NextResponse.json({ results });
  });
}
