"""Unit tests for Automated LLMOps Evaluation metrics and Pre-Deployment Quality Gate."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "evaluator" / "src"))

from evaluator.metrics import (
    CaseEvalResult,
    GateThresholds,
    compute_context_precision_at_k,
    compute_context_recall,
    compute_fact_coverage,
    evaluate_gate,
)


def test_context_precision_and_recall() -> None:
    # Rank 1 and 2 match expected doc, rank 3 does not -> AP = (1/1 + 2/2) / 2 = 1.0
    assert compute_context_precision_at_k(["doc-001", "doc-001", "doc-003"], ["doc-001"]) == 1.0
    # Rank 1 miss, rank 2 hit -> AP = (1/2) / 1 = 0.5
    assert compute_context_precision_at_k(["doc-003", "doc-001"], ["doc-001"]) == 0.5
    assert compute_context_recall(["doc-001", "doc-002"], ["doc-001", "doc-003"]) == 0.5
    assert compute_fact_coverage("MTTA is 15 minutes and MTTM is 60 minutes.", ["15 minutes", "60 minutes"]) == 1.0


def test_gate_passes_when_all_thresholds_met() -> None:
    cases = [
        CaseEvalResult(
            case_id="e1", category="factual", query="q1", unanswerable=False, abstained=False,
            hallucinated=False, hallucination_reason="Grounded", context_precision=0.95,
            context_recall=1.0, fact_coverage=1.0, cited_chunk_ids=["doc-001#0"],
            retrieved_doc_ids=["doc-001"], expected_doc_ids=["doc-001"],
            cost_usd=0.00035, latency_ms=950.0, answer_preview="ok",
        ),
        CaseEvalResult(
            case_id="e2", category="unanswerable", query="q2", unanswerable=True, abstained=True,
            hallucinated=False, hallucination_reason="Abstained", context_precision=None,
            context_recall=None, fact_coverage=None, cited_chunk_ids=[],
            retrieved_doc_ids=["doc-002"], expected_doc_ids=[],
            cost_usd=0.00025, latency_ms=820.0, answer_preview="Insufficient evidence",
        ),
    ]
    res = evaluate_gate(cases, GateThresholds(0.10, 0.75, 0.005))
    assert res["gate_passed"] is True
    assert res["summary"]["hallucination_rate"] == 0.0
    assert res["summary"]["abstention_accuracy"] == 1.0


def test_gate_fails_on_hallucination_or_cost_breach() -> None:
    cases = [
        CaseEvalResult(
            case_id="e1", category="factual", query="q1", unanswerable=False, abstained=False,
            hallucinated=True, hallucination_reason="Fabricated claim", context_precision=0.50,
            context_recall=0.50, fact_coverage=0.0, cited_chunk_ids=[],
            retrieved_doc_ids=["doc-002"], expected_doc_ids=["doc-001"],
            cost_usd=0.009, latency_ms=1500.0, answer_preview="wrong",
        ),
    ]
    res = evaluate_gate(cases, GateThresholds(0.10, 0.75, 0.005))
    assert res["gate_passed"] is False
    assert res["checks"]["hallucination_rate"]["passed"] is False
    assert res["checks"]["context_precision"]["passed"] is False
    assert res["checks"]["avg_cost_per_query_usd"]["passed"] is False
