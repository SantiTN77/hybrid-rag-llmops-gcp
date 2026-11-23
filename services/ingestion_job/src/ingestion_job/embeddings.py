"""Vertex AI embedding generator using google-genai SDK (gemini-embedding-001, 768-dim)."""

from __future__ import annotations

import os
import time
from typing import Sequence

from google import genai
from google.genai import types


class VertexEmbedder:
    """Generates normalized 768-dimensional dense embeddings via Vertex AI."""

    def __init__(
        self,
        project_id: str | None = None,
        location: str | None = None,
        model: str | None = None,
        output_dimensionality: int = 768,
    ) -> None:
        self.project_id = project_id or os.environ["GOOGLE_CLOUD_PROJECT"]
        self.location = location or os.environ.get("VERTEX_EMBEDDING_LOCATION", "us-central1")
        self.model = model or os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")
        self.output_dimensionality = output_dimensionality
        self._client = genai.Client(
            vertexai=True,
            project=self.project_id,
            location=self.location,
        )

    def embed_documents(self, texts: Sequence[str], batch_size: int = 16) -> list[list[float]]:
        """Embed document chunks in batches with exponential backoff on transient errors."""
        vectors: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = list(texts[i : i + batch_size])
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        delay = 0.25
        for attempt in range(4):
            try:
                response = self._client.models.embed_content(
                    model=self.model,
                    contents=batch,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=self.output_dimensionality,
                    ),
                )
                if not response.embeddings:
                    raise RuntimeError("Vertex AI returned empty embeddings list.")
                return [list(emb.values) for emb in response.embeddings]
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(delay)
                delay *= 2.0
        raise RuntimeError("Unreachable embedding retry exit.")
