"""Cloud Run v2 Ingestion Job entrypoint: GCS -> Chunk -> Vertex AI Embed -> Firestore Vector Search."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

from google.cloud import firestore, storage
from google.cloud.firestore_v1.vector import Vector

from ingestion_job.chunking import DocumentChunk, chunk_document
from ingestion_job.embeddings import VertexEmbedder


def log_structured(event_type: str, severity: str = "INFO", **fields: object) -> None:
    payload = {
        "severity": severity,
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    print(json.dumps(payload, default=str), flush=True)


def run_ingestion() -> dict[str, object]:
    start_ts = time.perf_counter()
    project_id = os.environ["GOOGLE_CLOUD_PROJECT"]
    bucket_name = os.environ["CORPUS_BUCKET"]
    prefix = os.environ.get("CORPUS_PREFIX", "corpus/")
    database_id = os.environ.get("FIRESTORE_DATABASE", "hybrid-rag-db")
    collection_name = os.environ.get("FIRESTORE_COLLECTION", "rag_chunks")
    embedding_dim = int(os.environ.get("EMBEDDING_DIMENSION", "768"))

    log_structured(
        "ingestion_started",
        project_id=project_id,
        bucket=bucket_name,
        prefix=prefix,
        database=database_id,
        collection=collection_name,
    )

    storage_client = storage.Client(project=project_id)
    bucket = storage_client.bucket(bucket_name)
    blobs = [
        b
        for b in bucket.list_blobs(prefix=prefix)
        if b.name.endswith(".md") or b.name.endswith(".txt")
    ]
    if not blobs:
        raise RuntimeError(f"No .md or .txt corpus files found in gs://{bucket_name}/{prefix}")

    all_chunks: list[DocumentChunk] = []
    doc_summaries: dict[str, dict[str, object]] = {}

    for blob in sorted(blobs, key=lambda b: b.name):
        raw_text = blob.download_as_text(encoding="utf-8")
        stem = os.path.splitext(os.path.basename(blob.name))[0]
        chunks = chunk_document(raw_text, fallback_doc_id=stem)
        all_chunks.extend(chunks)
        if chunks:
            doc_id = chunks[0].doc_id
            doc_summaries[doc_id] = {
                "doc_id": doc_id,
                "title": chunks[0].title,
                "source_uri": f"gs://{bucket_name}/{blob.name}",
                "chunk_count": len(chunks),
                "total_words": sum(c.word_count for c in chunks),
                "ingested_at": datetime.now(timezone.utc).isoformat(),
            }

    embedder = VertexEmbedder(
        project_id=project_id,
        output_dimensionality=embedding_dim,
    )
    vectors = embedder.embed_documents([c.content for c in all_chunks])

    db = firestore.Client(project=project_id, database=database_id)
    chunks_col = db.collection(collection_name)
    docs_col = db.collection("corpus_documents")

    # Upsert chunks in Firestore batches (max 500 ops per batch)
    batch = db.batch()
    ops = 0
    for chunk, vec in zip(all_chunks, vectors, strict=True):
        doc_ref = chunks_col.document(chunk.chunk_id.replace("/", "_"))
        batch.set(
            doc_ref,
            {
                "chunk_id": chunk.chunk_id,
                "doc_id": chunk.doc_id,
                "title": chunk.title,
                "section": chunk.section,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "tokens": chunk.tokens,
                "word_count": chunk.word_count,
                "content_hash": chunk.content_hash,
                "embedding": Vector(vec),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        ops += 1
        if ops >= 400:
            batch.commit()
            batch = db.batch()
            ops = 0

    for doc_id, summary in doc_summaries.items():
        batch.set(docs_col.document(doc_id), summary)
        ops += 1

    if ops > 0:
        batch.commit()

    duration_ms = round((time.perf_counter() - start_ts) * 1000, 2)
    result = {
        "documents_ingested": len(doc_summaries),
        "chunks_indexed": len(all_chunks),
        "embedding_model": embedder.model,
        "embedding_dimension": embedding_dim,
        "duration_ms": duration_ms,
        "database": database_id,
    }
    log_structured("ingestion_completed", **result)
    return result


def main() -> int:
    try:
        run_ingestion()
        return 0
    except Exception as exc:
        log_structured("ingestion_failed", severity="ERROR", error=str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
