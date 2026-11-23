# Demo Walkthrough — Enterprise Hybrid RAG & Automated LLMOps

## 1. Live UI Walkthrough (Vercel Production Console)
1. **Verify Live Private Cloud Run Connection**:
   - Observe the top status bar showing `Private Cloud Run Connected (OIDC)`, `$0.00 Idle Cost Policy`, and `Zero Browser GCP Creds`.
   - Confirm the top KPI strip displays **7 Docs** indexed in `hybrid-rag-db` (768-dim Firestore Vector Search) and the **LLMOps Quality Gate: PASS** badge loaded live from Firestore `evaluation_runs`.
2. **Run a Factual IAM Query (Hybrid RRF 0.60 / 0.40)**:
   - Click the **Private IAM & BFF Auth** sample chip and click **Run Hybrid RAG**.
   - Inspect the grounded answer from `gemini-3.8-flash` citing `[doc-001-cloud-run-iam#0]` and `[doc-001-cloud-run-iam#1]`.
   - Click any inline citation pill to highlight the exact source chunk and inspect its **Firestore Cosine Vector Score**, **Okapi BM25 Score**, and **Fused RRF Score**.
3. **Inspect Live FinOps & Cloud Logging Telemetry**:
   - Check the right-hand **Live Query FinOps & Latency Telemetry** panel: exact prompt/completion/embedding token counts, exact USD cost (typically `~$0.0002–$0.0005` per query), latency breakdown across Vertex AI Embedding, Firestore Vector Search, BM25, and Gemini 3.8 Flash, plus the Cloud Logging `trace_id`.
4. **Test Hallucination Resistance (Out-of-Scope Probe)**:
   - Click the **AWS EKS Budget (Out-of-Scope)** sample chip.
   - Observe the amber **Hallucination Guard: Abstained** badge and explicit `"Insufficient evidence in the indexed corpus"` response — zero fabricated AWS/Bedrock numbers.
5. **Compare Retrieval Modes**:
   - Switch between **Hybrid RRF (0.6/0.4)**, **Vector Only**, and **BM25 Lexical** to observe how RRF combines dense semantic recall with exact lexical precision (e.g., `roles/run.invoker`, `HTTP 429`).
6. **Inspect Automated LLMOps Quality Gate Dashboard**:
   - Scroll to the bottom table to inspect all 14 golden dataset cases, per-case grounding verdict, Context Precision@K, per-query USD cost, and latency.

## 2. Security & Zero-Trust Verification
- Direct unauthenticated `curl` to the Cloud Run URL returns `HTTP 403 Forbidden`.
- All browser requests go exclusively to `/api/*` on Vercel; inspect DevTools Network tab to confirm zero `Authorization` headers or GCP credentials appear in client traffic.
