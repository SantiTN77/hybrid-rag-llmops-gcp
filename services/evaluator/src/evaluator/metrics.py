"""Objective LLMOps evaluation metrics and pre-deployment quality gate logic."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class GateThresholds:
    max_hallucination_rate: float = 0.10
    min_context_precision: float = 0.75
    max_avg_cost_per_query_usd: float = 0.005


@dataclass(frozen=True)
class CaseEvalResult:
    case_id: str
    category: str
    query: str
    unanswerable: bool
    abstained: bool
    hallucinated: bool
    hallucination_reason: str
    context_precision: float | None
    context_recall: float | None
    fact_coverage: float | None
    cited_chunk_ids: list[str]
    retrieved_doc_ids: list[str]
    expected_doc_ids: list[str]
    cost_usd: float
    latency_ms: float
    answer_preview: str


def compute_context_precision_at_k(
    retrieved_doc_ids: list[str],
    expected_doc_ids: list[str],
) -> float:
    """Compute Average Precision@K (RAGAS-style Context Precision) over retrieved chunks."""
    if not expected_doc_ids:
        return 1.0
    expected_set = set(expected_doc_ids)
    relevant_hits = 0
    precision_sum = 0.0
    for idx, doc_id in enumerate(retrieved_doc_ids, start=1):
        if doc_id in expected_set:
            relevant_hits += 1
            precision_sum += relevant_hits / idx
    if relevant_hits == 0:
        return 0.0
    return round(precision_sum / relevant_hits, 4)


def compute_context_recall(
    retrieved_doc_ids: list[str],
    expected_doc_ids: list[str],
) -> float:
    """Fraction of expected ground-truth source documents retrieved in top-K."""
    if not expected_doc_ids:
        return 1.0
    retrieved_set = set(retrieved_doc_ids)
    hits = sum(1 for doc_id in expected_doc_ids if doc_id in retrieved_set)
    return round(hits / len(expected_doc_ids), 4)


def compute_fact_coverage(answer: str, expected_facts: list[str]) -> float:
    """Deterministic fraction of expected key facts present in the generated answer."""
    if not expected_facts:
        return 1.0
    lower = answer.lower()
    hits = sum(1 for fact in expected_facts if fact.lower() in lower)
    return round(hits / len(expected_facts), 4)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return round(ordered[int(k)], 8)
    return round(ordered[f] * (c - k) + ordered[c] * (k - f), 8)


def evaluate_gate(
    case_results: list[CaseEvalResult],
    thresholds: GateThresholds,
) -> dict[str, Any]:
    """Aggregate case metrics and evaluate strict Pre-Deployment Pass/Fail Quality Gate."""
    total_cases = len(case_results)
    if total_cases == 0:
        raise ValueError("Cannot evaluate quality gate on zero cases.")

    hallucinations = sum(1 for c in case_results if c.hallucinated)
    hallucination_rate = round(hallucinations / total_cases, 4)

    answerable_precisions = [c.context_precision for c in case_results if not c.unanswerable and c.context_precision is not None]
    answerable_recalls = [c.context_recall for c in case_results if not c.unanswerable and c.context_recall is not None]
    answerable_facts = [c.fact_coverage for c in case_results if not c.unanswerable and c.fact_coverage is not None]
    unanswerable_cases = [c for c in case_results if c.unanswerable]

    avg_precision = round(sum(answerable_precisions) / max(1, len(answerable_precisions)), 4)
    avg_recall = round(sum(answerable_recalls) / max(1, len(answerable_recalls)), 4)
    avg_fact_coverage = round(sum(answerable_facts) / max(1, len(answerable_facts)), 4)
    abstention_accuracy = (
        round(sum(1 for c in unanswerable_cases if c.abstained) / len(unanswerable_cases), 4)
        if unanswerable_cases
        else 1.0
    )

    costs = [c.cost_usd for c in case_results]
    latencies = [c.latency_ms for c in case_results]
    avg_cost = round(sum(costs) / total_cases, 8)
    p95_cost = percentile(costs, 95)
    avg_latency = round(sum(latencies) / total_cases, 2)
    p95_latency = round(percentile(latencies, 95), 2)

    checks = {
        "hallucination_rate": {
            "actual": hallucination_rate,
            "threshold": thresholds.max_hallucination_rate,
            "operator": "<=",
            "passed": hallucination_rate <= thresholds.max_hallucination_rate,
        },
        "context_precision": {
            "actual": avg_precision,
            "threshold": thresholds.min_context_precision,
            "operator": ">=",
            "passed": avg_precision >= thresholds.min_context_precision,
        },
        "avg_cost_per_query_usd": {
            "actual": avg_cost,
            "threshold": thresholds.max_avg_cost_per_query_usd,
            "operator": "<=",
            "passed": avg_cost <= thresholds.max_avg_cost_per_query_usd,
        },
    }
    gate_passed = all(c["passed"] for c in checks.values())

    return {
        "gate_passed": gate_passed,
        "thresholds": asdict(thresholds),
        "checks": checks,
        "summary": {
            "total_cases": total_cases,
            "answerable_cases": len(answerable_precisions),
            "unanswerable_cases": len(unanswerable_cases),
            "hallucinations_count": hallucinations,
            "hallucination_rate": hallucination_rate,
            "context_precision": avg_precision,
            "context_recall": avg_recall,
            "fact_coverage": avg_fact_coverage,
            "abstention_accuracy": abstention_accuracy,
            "avg_cost_per_query_usd": avg_cost,
            "p95_cost_per_query_usd": p95_cost,
            "total_eval_cost_usd": round(sum(costs), 8),
            "avg_latency_ms": avg_latency,
            "p95_latency_ms": p95_latency,
        },
    }
