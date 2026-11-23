import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

/**
 * Edge-of-BFF abuse protection for the public demo.
 *
 * The browser never talks to Cloud Run directly, so this BFF is the only place a
 * stranger can trigger paid Vertex AI calls. Two layers protect the budget:
 *   1. Vercel WAF rate-limit rule on /api/query (platform level, shared across instances).
 *   2. This in-process sliding window (defense in depth per Fluid Compute instance).
 * Cloud Run max_instance_count = 2 caps the blast radius on the GCP side.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 5_000;

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Hash so raw IPs never sit in memory or logs.
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - bucket.hits[0])) / 1000));
    return { ok: false, retryAfterSec };
  }
  bucket.hits.push(now);
  return { ok: true };
}

export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded for this public demo. Please retry shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

/**
 * Never echo upstream/internal error text (service URLs, IAM principals, stack details)
 * to anonymous browsers. Log it server-side with a correlation id instead.
 */
export function upstreamFailure(scope: string, err: unknown, traceId?: string): NextResponse {
  const id = traceId ?? `bff-${crypto.randomUUID().slice(0, 12)}`;
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[${scope}] trace=${id} upstream failure: ${detail.slice(0, 500)}`);
  return NextResponse.json(
    { error: `${scope} is temporarily unavailable.`, trace_id: id },
    { status: 502 }
  );
}
