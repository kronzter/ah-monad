import { NextResponse } from "next/server";
import { modelId } from "../../../agents/model";
import { getSession } from "../../server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const s = await getSession();
    return NextResponse.json({
      chainId: s.dep.chainId,
      settlement: s.dep.settlement,
      relayer: s.relayer.addresses[0],
      model: modelId,
      startBlock: s.startBlock.toString(),
    });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
