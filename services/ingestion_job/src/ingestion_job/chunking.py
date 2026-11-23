"""Semantic section-aware Markdown chunking, PII redaction, and lexical tokenization."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "has", "have", "in", "is", "it", "its", "of", "on", "or", "that",
        "the", "to", "was", "were", "will", "with", "this", "these", "those",
        "must", "can", "may", "not", "all", "any", "each", "their", "they",
        "them", "when", "where", "which", "who", "what", "how", "why",
    }
)

_PII_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("[REDACTED_SSN]", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("[REDACTED_CREDIT_CARD]", re.compile(r"\b(?:\d[ -]*?){13,16}\b")),
    (
        "[REDACTED_EMAIL]",
        re.compile(r"\b[A-Za-z0-9._%+-]+@(?!<project>\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    ),
    (
        "[REDACTED_PRIVATE_KEY]",
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----"),
    ),
    ("[REDACTED_API_KEY]", re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b")),
)


@dataclass(frozen=True)
class DocumentChunk:
    chunk_id: str
    doc_id: str
    title: str
    section: str
    chunk_index: int
    content: str
    tokens: list[str]
    word_count: int
    content_hash: str
    pii_redactions: int


def redact_pii(text: str) -> tuple[str, int]:
    """Deterministically redact PII and secret patterns prior to embedding."""
    redacted = text
    total = 0
    for placeholder, pattern in _PII_PATTERNS:
        redacted, count = pattern.subn(placeholder, redacted)
        total += count
    return redacted, total


def tokenize_lexical(text: str) -> list[str]:
    """Extract normalized lowercase lexical tokens preserving technical identifiers."""
    raw_tokens = re.findall(r"[a-zA-Z0-9][a-zA-Z0-9_./:-]*[a-zA-Z0-9]|[a-zA-Z0-9]", text.lower())
    return [tok for tok in raw_tokens if len(tok) >= 2 and tok not in STOPWORDS]


def parse_markdown_sections(markdown_text: str, fallback_doc_id: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Extract document title, doc_id, and (section_heading, section_body) tuples."""
    lines = markdown_text.splitlines()
    title = fallback_doc_id
    doc_id = fallback_doc_id
    sections: list[tuple[str, str]] = []
    current_heading = "Overview"
    current_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# ") and title == fallback_doc_id:
            title = stripped[2:].strip()
            continue
        if stripped.lower().startswith("document id:"):
            parsed_id = stripped.split(":", 1)[1].strip()
            if parsed_id:
                doc_id = parsed_id
            continue
        if not sections and any(
            stripped.lower().startswith(prefix)
            for prefix in ("version:", "owner:", "last updated:")
        ):
            continue
        if stripped.startswith("## "):
            body = "\n".join(current_lines).strip()
            if body:
                sections.append((current_heading, body))
            current_heading = stripped[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)

    tail = "\n".join(current_lines).strip()
    if tail:
        sections.append((current_heading, tail))

    return doc_id, title, sections


def chunk_document(
    markdown_text: str,
    fallback_doc_id: str,
    target_words: int = 240,
    overlap_words: int = 40,
) -> list[DocumentChunk]:
    """Chunk a markdown technical document by semantic H2 sections with word overlap."""
    redacted_text, total_redactions = redact_pii(markdown_text)
    doc_id, title, sections = parse_markdown_sections(redacted_text, fallback_doc_id)

    chunks: list[DocumentChunk] = []
    chunk_index = 0

    for section_heading, body in sections:
        words = body.split()
        if not words:
            continue

        if len(words) <= target_words:
            segments = [body]
        else:
            segments = []
            start = 0
            step = max(1, target_words - overlap_words)
            while start < len(words):
                end = min(len(words), start + target_words)
                segments.append(" ".join(words[start:end]))
                if end >= len(words):
                    break
                start += step

        for seg in segments:
            full_text = f"{title} — {section_heading}\n{seg}".strip()
            tokens = tokenize_lexical(full_text)
            chunk_id = f"{doc_id}#{chunk_index}"
            content_hash = hashlib.sha256(full_text.encode("utf-8")).hexdigest()[:16]
            chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    doc_id=doc_id,
                    title=title,
                    section=section_heading,
                    chunk_index=chunk_index,
                    content=full_text,
                    tokens=tokens,
                    word_count=len(full_text.split()),
                    content_hash=content_hash,
                    pii_redactions=total_redactions if chunk_index == 0 else 0,
                )
            )
            chunk_index += 1

    return chunks
