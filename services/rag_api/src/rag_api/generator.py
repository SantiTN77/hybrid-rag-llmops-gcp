"""Grounded RAG Answer Synthesis via Vertex AI Gemini 3.8 Flash."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

from google import genai
from google.genai import types

from rag_api.config import Settings
from rag_api.retrieval import RetrievedChunk

SYSTEM_PROMPT = """You are Meridian Enterprise Technical Knowledge Assistant.
Answer the user's question using ONLY the provided context chunks below.

Strict Grounding Rules:
1. Every factual claim MUST include an inline citation matching the exact chunk ID in square brackets, e.g. [doc-001-cloud-run-iam#0].
2. NEVER invent facts, numbers, people, policies, or cloud vendors that do not appear in the provided context chunks.
3. If the provided context chunks do NOT contain enough evidence to answer the question (for example, questions about AWS, executives, office Wi-Fi, or topics not present in the chunks), you MUST respond starting with the exact phrase:
   "Insufficient evidence in the indexed corpus"
   followed by a brief explanation of what is missing, without guessing or using outside knowledge.
4. Keep answers concise, technically precise, and well-structured."""

CITATION_RE = re.compile(r"\[(doc-[a-zA-Z0-9\-]+#\d+)\]")


@dataclass(frozen=True)
class GenerationResult:
    answer: str
    cited_chunk_ids: list[str]
    abstained: bool
    prompt_tokens: int
    completion_tokens: int
    generation_ms: float


def extract_citations(answer: str, valid_chunk_ids: set[str]) -> list[str]:
    found = CITATION_RE.findall(answer)
    return list(dict.fromkeys(cid for cid in found if cid in valid_chunk_ids))


def detect_abstention(answer: str) -> bool:
    lower = answer.lower()
    markers = (
        "insufficient evidence in the indexed corpus",
        "does not contain",
        "not mentioned in the provided context",
        "cannot be answered from the provided",
        "no information in the indexed corpus",
    )
    return any(m in lower for m in markers)


class GroundedGenerator:
    """Synthesizes grounded, cited answers with Vertex AI Gemini 3.8 Flash."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = genai.Client(
            vertexai=True,
            project=settings.project_id,
            location=settings.gemini_location,
        )

    def generate(self, query: str, chunks: list[RetrievedChunk]) -> GenerationResult:
        t0 = time.perf_counter()
        if not chunks:
            return GenerationResult(
                answer="Insufficient evidence in the indexed corpus to answer this query.",
                cited_chunk_ids=[],
                abstained=True,
                prompt_tokens=0,
                completion_tokens=0,
                generation_ms=round((time.perf_counter() - t0) * 1000, 2),
            )

        context_blocks = [
            f"### [{c.chunk_id}] ({c.title} | Section: {c.section})\n{c.content}"
            for c in chunks
        ]
        user_prompt = (
            "Context Chunks:\n"
            + "\n\n".join(context_blocks)
            + f"\n\nUser Question:\n{query}\n\n"
            + "Provide a grounded answer with inline [doc_id#chunk_index] citations, or abstain with 'Insufficient evidence in the indexed corpus'."
        )

        delay = 0.25
        response = None
        for attempt in range(4):
            try:
                response = self._client.models.generate_content(
                    model=self.settings.gemini_model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.1,
                        max_output_tokens=1024,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(delay)
                delay *= 2.0

        assert response is not None
        answer = (response.text or "").strip()
        if not answer:
            answer = "Insufficient evidence in the indexed corpus to generate a grounded response."

        usage = getattr(response, "usage_metadata", None)
        prompt_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        completion_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)

        valid_ids = {c.chunk_id for c in chunks}
        cited = extract_citations(answer, valid_ids)
        abstained = detect_abstention(answer)

        return GenerationResult(
            answer=answer,
            cited_chunk_ids=cited,
            abstained=abstained,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            generation_ms=round((time.perf_counter() - t0) * 1000, 2),
        )
