"""Hybrid Retrieval Engine: GCP Firestore Vector Search (COSINE) + Okapi BM25 + Reciprocal Rank Fusion."""

from __future__ import annotations

import math
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

from google import genai
from google.cloud import firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector
from google.genai import types

from rag_api.config import Settings

STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
        "the", "to", "was", "were", "will", "with", "this", "these", "those",
        "must", "can", "may", "not", "all", "any", "each", "their", "they",
        "them", "when", "where", "which", "who", "what", "how", "why",
    }
)


@dataclass(frozen=True)
class ChunkRecord:
    chunk_id: str
    doc_id: str
    title: str
    section: str
    chunk_index: int
    content: str
    tokens: tuple[str, ...]


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: str
    doc_id: str
    title: str
    section: str
    chunk_index: int
    content: str
    vector_score: float | None
    vector_rank: int | None
    bm25_score: float
    bm25_rank: int | None
    rrf_score: float


def tokenize_query(text: str) -> list[str]:
    raw_tokens = re.findall(r"[a-zA-Z0-9][a-zA-Z0-9_./:-]*[a-zA-Z0-9]|[a-zA-Z0-9]", text.lower())
    return [tok for tok in raw_tokens if len(tok) >= 2 and tok not in STOPWORDS]


def score_bm25(
    query_tokens: list[str],
    corpus: list[ChunkRecord],
    k1: float = 1.5,
    b: float = 0.75,
) -> list[tuple[ChunkRecord, float]]:
    """Compute Okapi BM25 scores for all chunks in the corpus."""
    if not query_tokens or not corpus:
        return []

    n_docs = len(corpus)
    avgdl = sum(len(c.tokens) for c in corpus) / max(1, n_docs)

    doc_freq: Counter[str] = Counter()
    for chunk in corpus:
        for tok in set(chunk.tokens):
            doc_freq[tok] += 1

    unique_q = list(dict.fromkeys(query_tokens))
    scored: list[tuple[ChunkRecord, float]] = []

    for chunk in corpus:
        tf_counts = Counter(chunk.tokens)
        dl = len(chunk.tokens)
        score = 0.0
        for tok in unique_q:
            tf = tf_counts.get(tok, 0)
            if tf == 0:
                continue
            df = doc_freq.get(tok, 0)
            idf = math.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
            denom = tf + k1 * (1.0 - b + b * (dl / max(1.0, avgdl)))
            score += idf * ((tf * (k1 + 1.0)) / denom)
        if score > 0.0:
            scored.append((chunk, round(score, 6)))

    scored.sort(key=lambda item: (-item[1], item[0].chunk_id))
    return scored


def fuse_rrf(
    vector_hits: list[tuple[ChunkRecord, float]],
    bm25_hits: list[tuple[ChunkRecord, float]],
    *,
    vector_weight: float = 0.60,
    lexical_weight: float = 0.40,
    rrf_k: int = 60,
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """Fuse dense vector hits and sparse BM25 hits via weighted Reciprocal Rank Fusion."""
    by_id: dict[str, ChunkRecord] = {}
    vec_rank_map: dict[str, tuple[int, float]] = {}
    bm25_rank_map: dict[str, tuple[int, float]] = {}

    for rank, (chunk, sim) in enumerate(vector_hits, start=1):
        by_id[chunk.chunk_id] = chunk
        vec_rank_map[chunk.chunk_id] = (rank, sim)

    for rank, (chunk, score) in enumerate(bm25_hits, start=1):
        by_id[chunk.chunk_id] = chunk
        bm25_rank_map[chunk.chunk_id] = (rank, score)

    fused: list[RetrievedChunk] = []
    for chunk_id, chunk in by_id.items():
        v_entry = vec_rank_map.get(chunk_id)
        l_entry = bm25_rank_map.get(chunk_id)

        rrf_score = 0.0
        if v_entry is not None and vector_weight > 0.0:
            rrf_score += vector_weight / (rrf_k + v_entry[0])
        if l_entry is not None and lexical_weight > 0.0:
            rrf_score += lexical_weight / (rrf_k + l_entry[0])

        if rrf_score <= 0.0:
            continue

        fused.append(
            RetrievedChunk(
                chunk_id=chunk.chunk_id,
                doc_id=chunk.doc_id,
                title=chunk.title,
                section=chunk.section,
                chunk_index=chunk.chunk_index,
                content=chunk.content,
                vector_score=round(v_entry[1], 4) if v_entry is not None else None,
                vector_rank=v_entry[0] if v_entry is not None else None,
                bm25_score=round(l_entry[1], 4) if l_entry is not None else 0.0,
                bm25_rank=l_entry[0] if l_entry is not None else None,
                rrf_score=round(rrf_score, 6),
            )
        )

    fused.sort(key=lambda item: (-item.rrf_score, -(item.vector_score or 0.0), item.chunk_id))
    return fused[:top_k]


class HybridRetriever:
    """Executes live Firestore Vector Search + BM25 lexical search + RRF."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._db = firestore.Client(
            project=settings.project_id,
            database=settings.firestore_database,
        )
        self._embed_client = genai.Client(
            vertexai=True,
            project=settings.project_id,
            location=settings.embedding_location,
        )
        self._lexical_cache: list[ChunkRecord] = []
        self._lexical_cache_ts: float = 0.0
        self._lexical_cache_ttl_sec: float = 120.0

    @property
    def db(self) -> firestore.Client:
        return self._db

    def _embed_query(self, query: str) -> list[float]:
        delay = 0.25
        for attempt in range(4):
            try:
                resp = self._embed_client.models.embed_content(
                    model=self.settings.embedding_model,
                    contents=query,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_QUERY",
                        output_dimensionality=self.settings.embedding_dimension,
                    ),
                )
                if not resp.embeddings:
                    raise RuntimeError("Vertex AI returned empty query embedding.")
                return list(resp.embeddings[0].values)
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(delay)
                delay *= 2.0
        raise RuntimeError("Unreachable embedding retry exit.")

    def _load_lexical_corpus(self, force_refresh: bool = False) -> list[ChunkRecord]:
        now = time.monotonic()
        if (
            not force_refresh
            and self._lexical_cache
            and (now - self._lexical_cache_ts) < self._lexical_cache_ttl_sec
        ):
            return self._lexical_cache

        records: list[ChunkRecord] = []
        col = self._db.collection(self.settings.chunks_collection)
        for snap in col.stream():
            data: dict[str, Any] = snap.to_dict() or {}
            tokens = data.get("tokens") or tokenize_query(str(data.get("content", "")))
            records.append(
                ChunkRecord(
                    chunk_id=str(data.get("chunk_id", snap.id)),
                    doc_id=str(data.get("doc_id", "unknown")),
                    title=str(data.get("title", "Untitled")),
                    section=str(data.get("section", "Overview")),
                    chunk_index=int(data.get("chunk_index", 0)),
                    content=str(data.get("content", "")),
                    tokens=tuple(str(t) for t in tokens),
                )
            )
        self._lexical_cache = records
        self._lexical_cache_ts = now
        return records

    def _vector_search(self, query_vec: list[float], limit: int) -> list[tuple[ChunkRecord, float]]:
        col = self._db.collection(self.settings.chunks_collection)
        vq = col.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vec),
            distance_measure=DistanceMeasure.COSINE,
            limit=limit,
            distance_result_field="vector_distance",
        )
        hits: list[tuple[ChunkRecord, float]] = []
        for snap in vq.stream():
            data: dict[str, Any] = snap.to_dict() or {}
            distance = float(data.get("vector_distance", 1.0))
            similarity = max(0.0, min(1.0, 1.0 - distance))
            tokens = data.get("tokens") or []
            record = ChunkRecord(
                chunk_id=str(data.get("chunk_id", snap.id)),
                doc_id=str(data.get("doc_id", "unknown")),
                title=str(data.get("title", "Untitled")),
                section=str(data.get("section", "Overview")),
                chunk_index=int(data.get("chunk_index", 0)),
                content=str(data.get("content", "")),
                tokens=tuple(str(t) for t in tokens),
            )
            hits.append((record, similarity))
        return hits

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        vector_weight: float = 0.60,
        lexical_weight: float = 0.40,
    ) -> tuple[list[RetrievedChunk], dict[str, float]]:
        candidate_limit = max(top_k * 3, 12)

        t0 = time.perf_counter()
        query_vec = self._embed_query(query) if vector_weight > 0.0 else []
        embedding_ms = round((time.perf_counter() - t0) * 1000, 2)

        t1 = time.perf_counter()
        vector_hits = self._vector_search(query_vec, candidate_limit) if vector_weight > 0.0 else []
        vector_search_ms = round((time.perf_counter() - t1) * 1000, 2)

        t2 = time.perf_counter()
        bm25_hits: list[tuple[ChunkRecord, float]] = []
        if lexical_weight > 0.0:
            corpus = self._load_lexical_corpus()
            q_tokens = tokenize_query(query)
            bm25_hits = score_bm25(q_tokens, corpus)[:candidate_limit]
        lexical_search_ms = round((time.perf_counter() - t2) * 1000, 2)

        fused = fuse_rrf(
            vector_hits,
            bm25_hits,
            vector_weight=vector_weight,
            lexical_weight=lexical_weight,
            rrf_k=self.settings.rrf_k,
            top_k=top_k,
        )
        timings = {
            "embedding_ms": embedding_ms,
            "vector_search_ms": vector_search_ms,
            "lexical_search_ms": lexical_search_ms,
        }
        return fused, timings
