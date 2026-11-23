import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { invokePrivateRagApi } from "@/lib/cloudRunClient";
import type { QueryResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      query?: string;
      top_k?: number;
      vector_weight?: number;
      lexical_weight?: number;
    };

    const query = (body.query ?? "").trim();
    if (query.length < 3 || query.length > 1200) {
      return NextResponse.json(
        { error: "Query must be between 3 and 1200 characters." },
        { status: 400 }
      );
    }

    const traceId = `bff-${crypto.randomUUID().slice(0, 12)}`;
    const data = await invokePrivateRagApi<QueryResponse>("/api/query", {
      method: "POST",
      traceId,
      body: {
        query,
        top_k: body.top_k ?? 5,
        vector_weight: body.vector_weight ?? 0.6,
        lexical_weight: body.lexical_weight ?? 0.4,
      },
    });
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hybrid RAG query failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
