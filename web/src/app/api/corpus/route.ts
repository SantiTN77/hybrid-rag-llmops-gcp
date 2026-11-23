import { NextResponse } from "next/server";
import { upstreamFailure } from "@/lib/guard";
import { invokePrivateRagApi } from "@/lib/cloudRunClient";
import type { CorpusResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await invokePrivateRagApi<CorpusResponse>("/api/corpus");
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return upstreamFailure("Indexed corpus", err);
  }
}
