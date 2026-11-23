"""FastAPI application for Enterprise Hybrid RAG API on Private Cloud Run v2."""

from __future__ import annotations

import time
from dataclasses import asdict
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from google.cloud import firestore
from pydantic import BaseModel, Field

from rag_api.config import Settings
from rag_api.generator import GroundedGenerator
from rag_api.retrieval import HybridRetriever
from rag_api.telemetry import (
    LatencyBreakdown,
    calculate_query_cost,
    emit_query_telemetry,
    estimate_tokens,
)

app = FastAPI(
    title="Enterprise Hybrid RAG API",
    version="1.0.0",
    description="Private Cloud Run v2 Hybrid RAG API with GCP Firestore Vector Search, Okapi BM25, RRF, and Vertex AI Gemini 3.8 Flash",
)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()


@lru_cache(maxsize=1)
def get_retriever() -> HybridRetriever:
    return HybridRetriever(get_settings())


@lru_cache(maxsize=1)
def get_generator() -> GroundedGenerator:
    return GroundedGenerator(get_settings())


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=1200)
    top_k: int = Field(default=5, ge=1, le=10)
    vector_weight: float = Field(default=0.60, ge=0.0, le=1.0)
    lexical_weight: float = Field(default=0.40, ge=0.0, le=1.0)


class EvaluationReportPayload(BaseModel):
    run_id: str
    timestamp: str
    dataset_version: str
    model: str
    embedding_model: str
    gate_passed: bool
    thresholds: dict[str, float]
    summary: dict[str, Any]
    cases: list[dict[str, Any]]


@app.get("/healthz")
@app.get("/api/health")
def healthz() -> dict[str, Any]:
    s = get_settings()
    return {
        "status": "ok",
        "service": "hybrid-rag-api",
        "model": s.gemini_model,
        "embedding_model": s.embedding_model,
        "firestore_database": s.firestore_database,
        "zero_idle_cost_policy": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/corpus")
def get_corpus() -> dict[str, Any]:
    s = get_settings()
    db = get_retriever().db
    docs: list[dict[str, Any]] = []
    for snap in db.collection(s.docs_collection).stream():
        data = snap.to_dict() or {}
        docs.append(data)
    docs.sort(key=lambda d: str(d.get("doc_id", "")))
    total_chunks = sum(int(d.get("chunk_count", 0)) for d in docs)
    total_words = sum(int(d.get("total_words", 0)) for d in docs)
    return {
        "database": s.firestore_database,
        "collection": s.chunks_collection,
        "embedding_model": s.embedding_model,
        "embedding_dimension": s.embedding_dimension,
        "document_count": len(docs),
        "total_chunks": total_chunks,
        "total_words": total_words,
        "documents": docs,
    }


@app.post("/api/query")
def query_rag(
    req: QueryRequest,
    x_trace_id: str | None = Header(default=None, alias="X-Trace-Id"),
) -> dict[str, Any]:
    if req.vector_weight == 0.0 and req.lexical_weight == 0.0:
        raise HTTPException(status_code=400, detail="At least one of vector_weight or lexical_weight must be > 0.")

    s = get_settings()
    t_total = time.perf_counter()

    retriever = get_retriever()
    generator = get_generator()

    chunks, r_timings = retriever.search(
        req.query,
        top_k=req.top_k,
        vector_weight=req.vector_weight,
        lexical_weight=req.lexical_weight,
    )
    gen = generator.generate(req.query, chunks)

    total_ms = round((time.perf_counter() - t_total) * 1000, 2)
    embedding_tokens = estimate_tokens(req.query) if req.vector_weight > 0.0 else 0
    cost = calculate_query_cost(
        prompt_tokens=gen.prompt_tokens,
        completion_tokens=gen.completion_tokens,
        embedding_tokens=embedding_tokens,
        rates=s.rates,
    )
    latency = LatencyBreakdown(
        embedding_ms=r_timings["embedding_ms"],
        vector_search_ms=r_timings["vector_search_ms"],
        lexical_search_ms=r_timings["lexical_search_ms"],
        generation_ms=gen.generation_ms,
        total_ms=total_ms,
    )

    trace_id = emit_query_telemetry(
        trace_id=x_trace_id,
        query=req.query,
        model=s.gemini_model,
        embedding_model=s.embedding_model,
        vector_weight=req.vector_weight,
        lexical_weight=req.lexical_weight,
        retrieved_chunk_ids=[c.chunk_id for c in chunks],
        cited_chunk_ids=gen.cited_chunk_ids,
        abstained=gen.abstained,
        cost=cost,
        latency=latency,
    )

    return {
        "trace_id": trace_id,
        "query": req.query,
        "answer": gen.answer,
        "abstained": gen.abstained,
        "cited_chunk_ids": gen.cited_chunk_ids,
        "retrieval_config": {
            "top_k": req.top_k,
            "vector_weight": req.vector_weight,
            "lexical_weight": req.lexical_weight,
            "rrf_k": s.rrf_k,
        },
        "chunks": [asdict(c) for c in chunks],
        "telemetry": {
            "model": s.gemini_model,
            "embedding_model": s.embedding_model,
            "cost": asdict(cost),
            "latency_ms": asdict(latency),
            "cloud_logging_event": "rag_query_telemetry",
        },
    }


@app.get("/api/evaluations")
def list_evaluations(limit: int = 5) -> dict[str, Any]:
    s = get_settings()
    db = get_retriever().db
    query = (
        db.collection(s.evals_collection)
        .order_by("timestamp", direction=firestore.Query.DESCENDING)
        .limit(max(1, min(limit, 20)))
    )
    runs = [snap.to_dict() for snap in query.stream()]
    return {
        "count": len(runs),
        "latest": runs[0] if runs else None,
        "runs": runs,
    }


@app.post("/api/evaluate")
def record_or_check_evaluation(payload: EvaluationReportPayload) -> dict[str, Any]:
    """Persist a verified LLMOps evaluation run report into Firestore."""
    s = get_settings()
    db = get_retriever().db
    doc_data = payload.model_dump()
    db.collection(s.evals_collection).document(payload.run_id).set(doc_data)
    return {
        "status": "persisted",
        "run_id": payload.run_id,
        "gate_passed": payload.gate_passed,
    }
