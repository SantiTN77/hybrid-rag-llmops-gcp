# 2-Minute Portfolio Video Script — Enterprise Hybrid RAG & LLMOps on GCP

## [0:00 – 0:20] Problem & Zero-Idle-Cost Architecture
"Most enterprise RAG demos break down in production for three reasons: always-on vector databases that burn hundreds of dollars a month at idle, pure vector search that misses exact error codes and IAM roles, and zero automated evaluation before shipping prompt changes.

In this project, I built a production-grade **Enterprise Hybrid RAG Pipeline with Automated LLMOps** on Google Cloud Platform with a strict **$0.00 idle cost policy**."

## [0:20 – 0:50] Serverless Ingestion & Hybrid Retrieval
"Technical documents in Cloud Storage are ingested asynchronously by a **Cloud Run v2 Job** orchestrated by **GCP Cloud Workflows**. It redacts PII, chunks by Markdown section, generates 768-dimensional embeddings via **Vertex AI `gemini-embedding-001`**, and upserts them into **GCP Firestore Vector Search**—completely serverless, zero always-on Vertex Vector Endpoints.

At query time, a **Private Cloud Run v2 FastAPI service** combines Firestore `find_nearest` cosine vector search with **Okapi BM25** lexical scoring via **Reciprocal Rank Fusion**, then synthesizes grounded answers with **Vertex AI `gemini-3.8-flash`** and inline `[doc_id#chunk]` citations."

## [0:50 – 1:25] Live Demo: Grounded Citations, FinOps & Hallucination Guard
"Here in the live Vercel Operations Console—connected to the private Cloud Run API through a server-side **OIDC BFF** with zero browser credentials—let's run a multi-hop architecture query. Notice the inline clickable citations, the per-chunk Vector, BM25, and RRF scores, and the live **FinOps telemetry panel** showing exact token usage, sub-millicent USD cost, and the Cloud Logging trace ID.

Now let's test hallucination resistance with an out-of-scope AWS EKS question. Instead of fabricating numbers, the model triggers our **Hallucination Guard** and cleanly abstains."

## [1:25 – 2:00] Automated LLMOps Pre-Deployment Gate & Close
"Finally, below is our **Automated LLMOps Quality Gate** evaluated against a 14-case Golden Dataset. It enforces Hallucination Rate <= 10%, Context Precision@K >= 75%, and Average Cost <= $0.005 per query—exiting non-zero in CI if any gate fails, and persisting results to Firestore and GCS.

Everything is provisioned via Terraform with private IAM, scale-to-zero Cloud Run, and full automated test coverage. Check out the GitHub repo and live demo link below."
