"""Unit tests for Okapi BM25, Reciprocal Rank Fusion (RRF), citations, and FinOps cost telemetry."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "rag_api" / "src"))

from rag_api.generator import detect_abstention, extract_citations
from rag_api.retrieval import ChunkRecord, fuse_rrf, score_bm25, tokenize_query
from rag_api.telemetry import calculate_query_cost, scrub_query_for_log


def _sample_chunks() -> list[ChunkRecord]:
    return [
        ChunkRecord(
            chunk_id="doc-001#0",
            doc_id="doc-001",
            title="IAM Guide",
            section="Zero Trust",
            chunk_index=0,
            content="Private Cloud Run requires roles/run.invoker and rejects unauthenticated HTTP 403.",
            tokens=tuple(tokenize_query("Private Cloud Run requires roles/run.invoker and rejects unauthenticated HTTP 403.")),
        ),
        ChunkRecord(
            chunk_id="doc-002#0",
            doc_id="doc-002",
            title="Firestore Runbook",
            section="Vector Search",
            chunk_index=0,
            content="Firestore Vector Search uses COSINE distance and 768 dimensions with $0.00 idle cost.",
            tokens=tuple(tokenize_query("Firestore Vector Search uses COSINE distance and 768 dimensions with $0.00 idle cost.")),
        ),
        ChunkRecord(
            chunk_id="doc-004#0",
            doc_id="doc-004",
            title="Incident SLA",
            section="Severity Tiers",
            chunk_index=0,
            content="SEV-1 critical outage requires MTTA 15 minutes and MTTM 60 minutes.",
            tokens=tuple(tokenize_query("SEV-1 critical outage requires MTTA 15 minutes and MTTM 60 minutes.")),
        ),
    ]


def test_bm25_ranks_exact_technical_match_first() -> None:
    chunks = _sample_chunks()
    hits = score_bm25(tokenize_query("roles/run.invoker HTTP 403"), chunks)
    assert len(hits) >= 1
    assert hits[0][0].chunk_id == "doc-001#0"


def test_rrf_fuses_vector_and_bm25_ranks() -> None:
    chunks = _sample_chunks()
    vector_hits = [(chunks[1], 0.91), (chunks[0], 0.85)]
    bm25_hits = [(chunks[0], 4.2), (chunks[2], 1.5)]

    fused = fuse_rrf(vector_hits, bm25_hits, vector_weight=0.60, lexical_weight=0.40, rrf_k=60, top_k=3)
    # doc-001#0 appears in BOTH lists (rank 2 vector, rank 1 bm25) -> highest combined RRF score
    assert fused[0].chunk_id == "doc-001#0"
    assert fused[0].vector_score == 0.85
    assert fused[0].bm25_score == 4.2
    assert fused[0].rrf_score > fused[1].rrf_score


def test_rrf_vector_only_and_lexical_only_modes() -> None:
    chunks = _sample_chunks()
    vector_hits = [(chunks[1], 0.95)]
    bm25_hits = [(chunks[2], 3.8)]

    vec_only = fuse_rrf(vector_hits, bm25_hits, vector_weight=1.0, lexical_weight=0.0, top_k=3)
    assert [c.chunk_id for c in vec_only] == ["doc-002#0"]

    lex_only = fuse_rrf(vector_hits, bm25_hits, vector_weight=0.0, lexical_weight=1.0, top_k=3)
    assert [c.chunk_id for c in lex_only] == ["doc-004#0"]


def test_citation_extraction_and_abstention() -> None:
    valid = {"doc-001-cloud-run-iam#0", "doc-004-incident-response-sla#1"}
    answer = "SEV-1 MTTA is 15m [doc-004-incident-response-sla#1] and IAM uses [doc-001-cloud-run-iam#0] not [doc-fake#9]."
    cited = extract_citations(answer, valid)
    assert cited == ["doc-004-incident-response-sla#1", "doc-001-cloud-run-iam#0"]
    assert detect_abstention(answer) is False
    assert detect_abstention("Insufficient evidence in the indexed corpus to answer AWS EKS questions.") is True


def test_finops_cost_calculation_and_log_scrubbing() -> None:
    cost = calculate_query_cost(prompt_tokens=1500, completion_tokens=200, embedding_tokens=20)
    # 1500/1M * 0.15 = 0.000225; 200/1M * 0.60 = 0.00012; 20/1M * 0.025 = 0.0000005 -> 0.0003455
    assert abs(cost.estimated_cost_usd - 0.0003455) < 1e-9
    assert cost.total_tokens == 1720

    scrubbed = scrub_query_for_log("Check Bearer eyJhbGciOiJSUzI1NiJ9.abc.def token")
    assert "eyJhbGci" not in scrubbed
    assert "[REDACTED]" in scrubbed
