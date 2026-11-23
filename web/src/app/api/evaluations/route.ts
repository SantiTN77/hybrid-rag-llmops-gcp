import { NextResponse } from "next/server";
import { upstreamFailure } from "@/lib/guard";
import { invokePrivateRagApi } from "@/lib/cloudRunClient";
import type { EvaluationsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await invokePrivateRagApi<EvaluationsResponse>("/api/evaluations?limit=5");
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return upstreamFailure("LLMOps evaluations", err);
  }
}
