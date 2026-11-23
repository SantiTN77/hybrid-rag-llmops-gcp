"""Exact per-query USD cost calculation and Cloud Logging structured JSON telemetry."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from rag_api.config import FinOpsRates

_SCRUB_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"Bearer\s+[A-Za-z0-9\-_\.]+", re.IGNORECASE),
    re.compile(r"AIza[0-9A-Za-z\-_]{35}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
)


@dataclass(frozen=True)
class CostBreakdown:
    prompt_tokens: int
    completion_tokens: int
    embedding_tokens: int
    total_tokens: int
    input_cost_usd: float
    output_cost_usd: float
    embedding_cost_usd: float
    estimated_cost_usd: float


@dataclass(frozen=True)
class LatencyBreakdown:
    embedding_ms: float
    vector_search_ms: float
    lexical_search_ms: float
    generation_ms: float
    total_ms: float


def estimate_tokens(text: str) -> int:
    """Fast deterministic token estimator when provider metadata omits embedding token count."""
    words = len(text.split())
    return max(1, int(round(words * 1.35)))


def calculate_query_cost(
    prompt_tokens: int,
    completion_tokens: int,
    embedding_tokens: int,
    rates: FinOpsRates | None = None,
) -> CostBreakdown:
    rate = rates or FinOpsRates()
    input_cost = (prompt_tokens / 1_000_000.0) * rate.input_per_1m_usd
    output_cost = (completion_tokens / 1_000_000.0) * rate.output_per_1m_usd
    emb_cost = (embedding_tokens / 1_000_000.0) * rate.embedding_per_1m_usd
    total_cost = input_cost + output_cost + emb_cost
    return CostBreakdown(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        embedding_tokens=embedding_tokens,
        total_tokens=prompt_tokens + completion_tokens + embedding_tokens,
        input_cost_usd=round(input_cost, 8),
        output_cost_usd=round(output_cost, 8),
        embedding_cost_usd=round(emb_cost, 8),
        estimated_cost_usd=round(total_cost, 8),
    )


def scrub_query_for_log(query: str, max_len: int = 512) -> str:
    cleaned = query[:max_len]
    for pat in _SCRUB_PATTERNS:
        cleaned = pat.sub("[REDACTED]", cleaned)
    return cleaned


def emit_query_telemetry(
    *,
    trace_id: str | None,
    query: str,
    model: str,
    embedding_model: str,
    vector_weight: float,
    lexical_weight: float,
    retrieved_chunk_ids: list[str],
    cited_chunk_ids: list[str],
    abstained: bool,
    cost: CostBreakdown,
    latency: LatencyBreakdown,
) -> str:
    """Emit structured JSON log record captured natively by Google Cloud Logging."""
    resolved_trace_id = trace_id or str(uuid.uuid4())
    payload = {
        "severity": "INFO",
        "event_type": "rag_query_telemetry",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "trace_id": resolved_trace_id,
        "query_preview": scrub_query_for_log(query),
        "model": model,
        "embedding_model": embedding_model,
        "weights": {"vector": vector_weight, "lexical": lexical_weight},
        "retrieved_count": len(retrieved_chunk_ids),
        "retrieved_chunk_ids": retrieved_chunk_ids,
        "cited_chunk_ids": cited_chunk_ids,
        "abstained": abstained,
        "estimated_cost_usd": cost.estimated_cost_usd,
        "cost": asdict(cost),
        "latency_ms": asdict(latency),
    }
    print(json.dumps(payload, default=str), flush=True)
    return resolved_trace_id
