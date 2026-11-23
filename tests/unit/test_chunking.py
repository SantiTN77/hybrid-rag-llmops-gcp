"""Unit tests for semantic Markdown chunking, PII redaction, and lexical tokenization."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "ingestion_job" / "src"))

from ingestion_job.chunking import chunk_document, redact_pii, tokenize_lexical


def test_redact_pii_replaces_sensitive_tokens() -> None:
    fake_api_key = "AIza" + "SyD" + ("0" * 32)
    raw = f"Contact ops@meridian.io with SSN 123-45-6789 and key {fake_api_key}."
    redacted, count = redact_pii(raw)
    assert count == 3
    assert "[REDACTED_EMAIL]" in redacted
    assert "[REDACTED_SSN]" in redacted
    assert "[REDACTED_API_KEY]" in redacted
    assert "123-45-6789" not in redacted
    assert "ops@meridian.io" not in redacted


def test_chunk_document_extracts_metadata_and_sections() -> None:
    md = """# Sample Enterprise Guide
Document ID: doc-999-sample
Version: 1.0

## 1. IAM Controls
All Cloud Run services must enforce roles/run.invoker with zero allUsers bindings.

## 2. FinOps Policy
Cloud Run min_instance_count = 0 and max_instance_count = 2 enforce zero idle cost.
"""
    chunks = chunk_document(md, fallback_doc_id="fallback")
    assert len(chunks) == 2
    assert chunks[0].doc_id == "doc-999-sample"
    assert chunks[0].chunk_id == "doc-999-sample#0"
    assert chunks[0].section == "1. IAM Controls"
    assert "roles/run.invoker" in chunks[0].tokens
    assert chunks[1].chunk_id == "doc-999-sample#1"
    assert chunks[1].section == "2. FinOps Policy"


def test_chunk_document_splits_long_section_with_overlap() -> None:
    long_body = " ".join(f"token{i}" for i in range(400))
    md = f"# Long Doc\nDocument ID: doc-long\n\n## Big Section\n{long_body}\n"
    chunks = chunk_document(md, fallback_doc_id="doc-long", target_words=150, overlap_words=30)
    assert len(chunks) >= 3
    assert "token140" in chunks[0].content
    assert "token140" in chunks[1].content


def test_tokenize_lexical_filters_stopwords_and_preserves_identifiers() -> None:
    tokens = tokenize_lexical("The roles/run.invoker policy requires HTTP 403 and gemini-3.8-flash.")
    assert "the" not in tokens
    assert "roles/run.invoker" in tokens
    assert "403" in tokens
    assert "gemini-3.8-flash" in tokens
