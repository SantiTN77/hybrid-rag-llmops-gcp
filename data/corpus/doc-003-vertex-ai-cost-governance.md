# Vertex AI & Gemini FinOps Cost Governance Policy
Document ID: doc-003-vertex-ai-cost-governance
Version: 1.9
Owner: AI FinOps & Cloud Architecture Board
Last Updated: 2026-10-28

## 1. Approved Production Models & Endpoints
All enterprise generative AI workloads on GCP MUST invoke Vertex AI endpoints using Application Default Credentials (`GOOGLE_GENAI_USE_VERTEXAI=TRUE`). Direct consumer API keys (`AIza...`) are forbidden in production services.
Approved default models:
- **Primary Reasoning & RAG Synthesis**: `gemini-3.8-flash` on the Vertex AI `global` endpoint (`GOOGLE_CLOUD_LOCATION=global`).
- **Embedding Generation**: `gemini-embedding-001` (with `output_dimensionality=768`) or `text-embedding-005` (native 768 dimensions) in `us-central1`.

## 2. Token Accounting & Cost-Per-Query Telemetry
Every production RAG query MUST compute and emit a structured JSON log record to Google Cloud Logging (`jsonPayload.event_type = "rag_query_telemetry"`) containing:
- `trace_id`: Correlation ID propagated from the BFF request header `X-Trace-Id`.
- `prompt_tokens`, `completion_tokens`, `embedding_tokens`, and `total_tokens`.
- `latency_ms` breakdown (`embedding_ms`, `vector_search_ms`, `lexical_search_ms`, `generation_ms`, `total_ms`).
- `estimated_cost_usd`: Exact USD cost computed using Meridian's standardized FinOps rate card:
  - `gemini-3.8-flash` input tokens: `$0.15` per 1,000,000 tokens
  - `gemini-3.8-flash` output tokens: `$0.60` per 1,000,000 tokens
  - Vertex AI embedding tokens (`gemini-embedding-001` / `text-embedding-005`): `$0.025` per 1,000,000 tokens

## 3. Budget Thresholds & Automated Cost Alerts
- **Per-Query Cost Ceiling**: Standard RAG queries MUST average `<= $0.005` USD per query (target `< $0.001` USD). Any release candidate exceeding `$0.005` average cost per query in the automated LLMOps evaluation suite is automatically blocked from production promotion.
- **Monthly Sandbox/Portfolio Cap**: $25.00 USD/month with GCP Billing Budget alerts at 50%, 80%, and 100%.
- **Prompt Context Budget**: Retrieved context injected into the Gemini synthesis prompt MUST be capped at `top_k = 5` chunks (maximum ~2,000 context tokens) to prevent context-stuffing cost spikes and "lost in the middle" degradation.
