import { NextResponse } from "next/server";
import { runInjectionAttack } from "../../../agents/competitor";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const s = await getSession();
    const results = await runInjectionAttack(s.vendor);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
