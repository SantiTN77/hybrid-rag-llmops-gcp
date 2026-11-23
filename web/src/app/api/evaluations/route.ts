import { NextResponse } from "next/server";
import { invokePrivateRagApi } from "@/lib/cloudRunClient";
import type { EvaluationsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await invokePrivateRagApi<EvaluationsResponse>("/api/evaluations?limit=5");
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load LLMOps evaluations";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
