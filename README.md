# Enterprise Hybrid RAG Pipeline with Automated LLMOps on GCP

[![GCP Firestore Vector Search](https://img.shields.io/badge/GCP-Firestore%20Vector%20Search-4285F4?logo=googlecloud)](https://cloud.google.com/firestore/docs/vector-search)
[![Vertex AI Gemini 3.8 Flash](https://img.shields.io/badge/Vertex%20AI-gemini--3.8--flash-34A853?logo=googlecloud)](https://cloud.google.com/vertex-ai)
[![Zero Idle Cost](https://img.shields.io/badge/FinOps-%240.00%20Idle%20Cost-10B981)](docs/ARCHITECTURE.md)
[![LLMOps Gate PASS](https://img.shields.io/badge/LLMOps%20Gate-PASS%20(0%25%20Hallucination)-10B981)](docs/VERIFICATION.md)

A production-grade, 100% serverless **Enterprise Hybrid RAG & Automated LLMOps** platform on Google Cloud Platform featuring **GCP Firestore Vector Search** (`find_nearest` COSINE 768d) + **Okapi BM25** fused via **Reciprocal Rank Fusion (RRF)**, **Vertex AI `gemini-3.8-flash`** grounded synthesis with inline `[doc_id#chunk]` citations, **Cloud Run v2 Jobs + Cloud Workflows** asynchronous ingestion, **Cloud Logging** FinOps cost-per-query telemetry, an **Automated Pre-Deployment LLMOps Quality Gate**, and a **Vercel Next.js App Router OIDC BFF** web console.

## Live Production Deployment
- **Vercel Operations Console (OIDC BFF)**: https://hybrid-rag-llmops-gcp-web.vercel.app
- **Private Cloud Run v2 Hybrid RAG API**: `https://hybrid-rag-api-epheuj6evq-uc.a.run.app` *(Private IAM — unauthenticated direct requests return `HTTP 403 Forbidden`)*
- **GitHub Repository**: https://github.com/SantiTN77/hybrid-rag-llmops-gcp

## Live Automated LLMOps Quality Gate Results (`eval-20261123-153245-9c9b57`)

| Metric | Live Result | Pre-Deploy Gate Threshold | Status |
| :--- | :---: | :---: | :---: |
| **Hallucination Rate** (14 golden cases incl. 3 negative probes) | **0.00%** | `<= 10.0%` | **PASS** |
| **Context Precision@K** (Average Precision@5) | **98.79%** | `>= 75.0%` | **PASS** |
| **Context Recall@K** (Expected source doc coverage) | **100.00%** | — | **PASS** |
| **Unanswerable Abstention Accuracy** (3 out-of-scope probes) | **100.00%** | — | **PASS** |
| **Average Cost per Query (USD)** | **$0.000346** | `<= $0.005000` | **PASS** |

## Architecture Highlights
1. **Zero Idle Cost Policy ($0.00/mo idle)**:
   - Uses **GCP Firestore Native Vector Search** (`hybrid-rag-db`, 768-dim `FLAT` `COSINE` index) instead of always-on Vertex AI Vector Search Index Endpoints ($75–$140/mo).
   - Private Cloud Run v2 API enforces `min_instance_count = 0`, `max_instance_count = 2`, `cpu_idle = true`, `deletion_protection = false`.
2. **Asynchronous Ingestion (`services/ingestion_job/` + `workflows/ingest_and_eval.yaml`)**:
   - GCP Cloud Workflow triggers the Cloud Run v2 Ingestion Job, which reads Markdown technical documents from GCS, redacts PII/secrets (`[REDACTED_SSN]`, `[REDACTED_EMAIL]`, `[REDACTED_API_KEY]`), chunks by H2 section with overlap, generates 768-dim `gemini-embedding-001` embeddings, and upserts `Vector(embedding)` + BM25 tokens into Firestore.
3. **Hybrid Search & Grounded Synthesis (`services/rag_api/`)**:
   - Combines Firestore `find_nearest` (COSINE) with Okapi BM25 via weighted RRF (`k = 60`, `w_v = 0.60`, `w_l = 0.40`).
   - Synthesizes answers with Vertex AI `gemini-3.8-flash` enforcing inline `[doc_id#chunk]` citations and explicit `"Insufficient evidence in the indexed corpus"` abstention.
   - Emits structured JSON `rag_query_telemetry` logs with exact USD cost to Cloud Logging + a Terraform-provisioned log-based distribution metric (`hybrid_rag_query_cost_usd`).
4. **Zero-Trust Private IAM + Vercel OIDC BFF (`web/`, strictly `pnpm`)**:
   - `roles/run.invoker` granted exclusively to `rag-vercel-bff-invoker` (zero `allUsers` bindings).
   - Server-side Next.js API routes mint Google OIDC ID tokens via `google-auth-library`; zero GCP credentials are exposed to browsers.

## Repository Structure
- `data/corpus/` — 7 synthetic enterprise technical guides & runbooks (23 indexed chunks)
- `data/golden_dataset.json` — 14-case Golden Evaluation Dataset (factual, numeric SLA, multi-hop, unanswerable)
- `services/ingestion_job/` — Python 3.12 (`uv`) Cloud Run v2 Ingestion Job
- `services/rag_api/` — Python 3.12 (`uv`) Private Cloud Run v2 FastAPI Hybrid RAG API
- `services/evaluator/` — Automated LLMOps Evaluation Pipeline & Pre-Deployment Quality Gate (`exit 1` on FAIL)
- `workflows/ingest_and_eval.yaml` — GCP Cloud Workflow orchestrator
- `infra/terraform/` — Complete Terraform IaC (APIs, AR, GCS, Firestore Native + Vector Index, SAs, Private Cloud Run, Workflows, Logging Metric)
- `web/` — Next.js 15 App Router UI + Server-Side OIDC BFF (`pnpm` exclusively)
- `tests/` — 15 unit/policy tests + 3 live E2E tests
- `docs/` — [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEMO_WALKTHROUGH.md](docs/DEMO_WALKTHROUGH.md), [VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md), [VERIFICATION.md](docs/VERIFICATION.md)

## Quickstart & Verification
```powershell
# 1. Run unit & Terraform policy tests (15 passed)
uv run --with pytest --with pydantic --with google-cloud-firestore --with google-genai pytest tests/unit -v

# 2. Validate Terraform
terraform -chdir=infra/terraform init -backend=false
terraform -chdir=infra/terraform validate

# 3. Build web UI (pnpm only)
cd web && pnpm install && pnpm typecheck && pnpm build

# 4. Run Secret Scan (0 findings)
.\scripts\secret-scan.ps1
```
