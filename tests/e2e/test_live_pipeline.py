"""Live End-to-End Verification Suite for Private Cloud Run Hybrid RAG API & Vercel BFF."""

from __future__ import annotations

import os
import pytest
import httpx
from google.auth.transport.requests import Request
from google.oauth2 import service_account

RAG_API_URL = os.environ.get("LIVE_RAG_API_URL", "").rstrip("/")
VERCEL_URL = os.environ.get("LIVE_VERCEL_URL", "").rstrip("/")
SA_KEY_PATH = os.environ.get("GCP_SA_KEY_PATH", "")


def _get_oidc_token() -> str:
    creds = service_account.IDTokenCredentials.from_service_account_file(
        SA_KEY_PATH,
        target_audience=RAG_API_URL,
    )
    creds.refresh(Request())
    assert creds.token
    return str(creds.token)


@pytest.mark.skipif(not RAG_API_URL, reason="LIVE_RAG_API_URL not set")
def test_private_cloud_run_rejects_unauthenticated_requests() -> None:
    resp = httpx.get(f"{RAG_API_URL}/api/health", timeout=20.0)
    assert resp.status_code in (401, 403), f"Expected 401/403, got {resp.status_code}"


@pytest.mark.skipif(not (RAG_API_URL and SA_KEY_PATH), reason="LIVE_RAG_API_URL or GCP_SA_KEY_PATH not set")
def test_oidc_authenticated_health_corpus_query_and_evaluations() -> None:
    token = _get_oidc_token()
    headers = {"Authorization": f"Bearer {token}"}

    h = httpx.get(f"{RAG_API_URL}/api/health", headers=headers, timeout=30.0)
    assert h.status_code == 200
    assert h.json()["status"] == "ok"
    assert h.json()["zero_idle_cost_policy"] is True

    c = httpx.get(f"{RAG_API_URL}/api/corpus", headers=headers, timeout=30.0)
    assert c.status_code == 200
    corpus = c.json()
    assert corpus["document_count"] >= 7
    assert corpus["total_chunks"] >= 14

    # Answerable hybrid RAG query
    q = httpx.post(
        f"{RAG_API_URL}/api/query",
        headers=headers,
        json={
            "query": "What are the MTTA and MTTM SLAs for a SEV-1 critical outage?",
            "top_k": 5,
            "vector_weight": 0.6,
            "lexical_weight": 0.4,
        },
        timeout=45.0,
    )
    assert q.status_code == 200
    q_data = q.json()
    assert q_data["abstained"] is False
    assert len(q_data["cited_chunk_ids"]) >= 1
    assert "15" in q_data["answer"]
    assert q_data["telemetry"]["cost"]["estimated_cost_usd"] > 0
    assert q_data["telemetry"]["cost"]["estimated_cost_usd"] < 0.005

    # Unanswerable negative query (hallucination resistance)
    neg = httpx.post(
        f"{RAG_API_URL}/api/query",
        headers=headers,
        json={
            "query": "What is Meridian's AWS EKS cluster budget and Amazon Bedrock Claude pricing?",
            "top_k": 5,
            "vector_weight": 0.6,
            "lexical_weight": 0.4,
        },
        timeout=45.0,
    )
    assert neg.status_code == 200
    assert neg.json()["abstained"] is True

    # Persisted LLMOps evaluation run
    ev = httpx.get(f"{RAG_API_URL}/api/evaluations", headers=headers, timeout=30.0)
    assert ev.status_code == 200
    ev_data = ev.json()
    assert ev_data["count"] >= 1
    assert ev_data["latest"]["gate_passed"] is True


@pytest.mark.skipif(not VERCEL_URL, reason="LIVE_VERCEL_URL not set")
def test_vercel_bff_routes_end_to_end() -> None:
    h = httpx.get(f"{VERCEL_URL}/api/health", timeout=30.0)
    assert h.status_code == 200
    assert h.json()["status"] == "ok"

    c = httpx.get(f"{VERCEL_URL}/api/corpus", timeout=30.0)
    assert c.status_code == 200
    assert c.json()["document_count"] >= 7

    ev = httpx.get(f"{VERCEL_URL}/api/evaluations", timeout=30.0)
    assert ev.status_code == 200
    assert ev.json()["latest"]["gate_passed"] is True
