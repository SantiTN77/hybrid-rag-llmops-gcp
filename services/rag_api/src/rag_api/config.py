"""Runtime configuration and FinOps cost rate card for Hybrid RAG API."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class FinOpsRates:
    """Standardized USD per 1,000,000 tokens rate card (doc-003-vertex-ai-cost-governance)."""

    input_per_1m_usd: float = 0.15
    output_per_1m_usd: float = 0.60
    embedding_per_1m_usd: float = 0.025


@dataclass(frozen=True)
class Settings:
    project_id: str
    gemini_location: str
    embedding_location: str
    gemini_model: str
    embedding_model: str
    embedding_dimension: int
    firestore_database: str
    chunks_collection: str
    docs_collection: str
    evals_collection: str
    corpus_bucket: str
    rrf_k: int
    default_vector_weight: float
    default_lexical_weight: float
    default_top_k: int
    rates: FinOpsRates = FinOpsRates()

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            project_id=os.environ.get("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0527325883"),
            gemini_location=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
            embedding_location=os.environ.get("VERTEX_EMBEDDING_LOCATION", "us-central1"),
            gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
            embedding_model=os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001"),
            embedding_dimension=int(os.environ.get("EMBEDDING_DIMENSION", "768")),
            firestore_database=os.environ.get("FIRESTORE_DATABASE", "hybrid-rag-db"),
            chunks_collection=os.environ.get("FIRESTORE_COLLECTION", "rag_chunks"),
            docs_collection=os.environ.get("FIRESTORE_DOCS_COLLECTION", "corpus_documents"),
            evals_collection=os.environ.get("FIRESTORE_EVALS_COLLECTION", "evaluation_runs"),
            corpus_bucket=os.environ.get("CORPUS_BUCKET", ""),
            rrf_k=int(os.environ.get("RRF_K", "60")),
            default_vector_weight=float(os.environ.get("DEFAULT_VECTOR_WEIGHT", "0.60")),
            default_lexical_weight=float(os.environ.get("DEFAULT_LEXICAL_WEIGHT", "0.40")),
            default_top_k=int(os.environ.get("DEFAULT_TOP_K", "5")),
        )
