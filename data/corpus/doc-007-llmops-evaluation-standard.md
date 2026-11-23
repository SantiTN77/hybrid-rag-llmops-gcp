# Automated LLMOps Evaluation & Pre-Deployment Quality Gate Standard
Document ID: doc-007-llmops-evaluation-standard
Version: 2.2
Owner: Applied AI & LLMOps Platform Team
Last Updated: 2026-10-30

## 1. Mandatory Pre-Deployment Quality Gate
No prompt template, chunking strategy, embedding model, or retrieval weight change may be promoted to production without passing the Automated LLMOps Evaluation Suite against the version-controlled Golden Evaluation Dataset (`data/golden_dataset.json`).

The evaluation pipeline enforces three non-negotiable release gate thresholds:
1. **Hallucination Rate**: MUST be `<= 0.10` (10%). Measured across both factual queries (every factual claim must be supported by retrieved chunks with valid `[doc_id#chunk]` inline citations) and negative/unanswerable queries (the model MUST abstain and state that the corpus does not contain the requested information).
2. **Context Precision@K**: MUST be `>= 0.75` (75%). Measures the proportion of expected ground-truth source documents successfully retrieved in the top-K hybrid search results for answerable queries.
3. **Average Cost per Query (USD)**: MUST be `<= $0.005` USD across the entire golden dataset run.

If ANY threshold fails, the evaluator process MUST exit with a non-zero exit code (`exit 1`), blocking CI/CD deployment.

## 2. Grounding & Unanswerable Abstention Protocol
When the RAG API synthesizes an answer using `gemini-3.8-flash`, the system prompt enforces strict grounding:
- Every factual statement MUST include an inline citation formatted as `[doc_id#chunk_index]` (for example, `[doc-001-cloud-run-iam#0]`).
- If the retrieved chunks do not contain sufficient evidence to answer the user's question—or if the question asks about topics outside the indexed corpus—the model MUST explicitly abstain using the phrase `"Insufficient evidence in the indexed corpus"` rather than fabricating facts from parametric memory.

## 3. Evaluation Artifact Persistence
Every evaluation run produces a deterministic JSON report (`run_id`, timestamp, git/model metadata, aggregate metrics, gate PASS/FAIL status, and per-case scores) persisted to both:
- Firestore collection `evaluation_runs` (for real-time dashboard display in the Vercel Operations Console).
- GCS bucket `gs://<corpus-bucket>/evaluations/<run_id>.json` (for immutable compliance archival).
