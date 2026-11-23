import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { invokePrivateRagApi } from "@/lib/cloudRunClient";
import { clientKey, rateLimit, tooManyRequests, upstreamFailure } from "@/lib/guard";
import type { QueryResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_MINUTE = 6;
const PER_DAY = 60;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export async function POST(req: NextRequest) {
  const key = clientKey(req);
  const minute = rateLimit(`q:m:${key}`, PER_MINUTE, 60_000);
  if (!minute.ok) return tooManyRequests(minute.retryAfterSec);
  const day = rateLimit(`q:d:${key}`, PER_DAY, 86_400_000);
  if (!day.ok) return tooManyRequests(day.retryAfterSec);

  let body: {
    query?: unknown;
    top_k?: unknown;
    vector_weight?: unknown;
    lexical_weight?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 3 || query.length > 1200) {
    return NextResponse.json(
      { error: "Query must be between 3 and 1200 characters." },
      { status: 400 }
    );
  }

  const vectorWeight = clamp(body.vector_weight, 0, 1, 0.6);
  const lexicalWeight = clamp(body.lexical_weight, 0, 1, 0.4);
  if (vectorWeight === 0 && lexicalWeight === 0) {
    return NextResponse.json(
      { error: "At least one retrieval weight must be greater than zero." },
      { status: 400 }
    );
  }

  const traceId = `bff-${crypto.randomUUID().slice(0, 12)}`;
  try {
    const data = await invokePrivateRagApi<QueryResponse>("/api/query", {
      method: "POST",
      traceId,
      body: {
        query,
        top_k: Math.round(clamp(body.top_k, 1, 10, 5)),
        vector_weight: vectorWeight,
        lexical_weight: lexicalWeight,
      },
    });
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    return upstreamFailure("Hybrid RAG query", err, traceId);
  }
}
