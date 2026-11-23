# Enterprise Cloud Run v2 IAM & Zero-Trust BFF Architecture Guide
Document ID: doc-001-cloud-run-iam
Version: 2.4
Owner: Cloud Platform Security Engineering
Last Updated: 2026-10-15

## 1. Zero-Trust Invocation Policy
All production Cloud Run v2 services operated by Meridian Cloud Platform MUST reject unauthenticated public traffic. Granting `roles/run.invoker` to `allUsers` or `allAuthenticatedUsers` is strictly prohibited by Organization Policy `constraints/iam.allowedPolicyMemberDomains` and CI Terraform policy checks.

Every external web application MUST route requests through a dedicated Backend-for-Frontend (BFF) hosted on Vercel or an internal API Gateway. The BFF mints short-lived Google OIDC Identity Tokens (`aud` set to the exact Cloud Run service URL) using a dedicated least-privilege invoker Service Account (`rag-vercel-bff-invoker@<project>.iam.gserviceaccount.com`). Unauthenticated direct HTTP requests to any private Cloud Run endpoint MUST return HTTP `401 Unauthorized` or `403 Forbidden`.

## 2. Service Account Separation of Duties
Meridian enforces strict least-privilege identity boundaries across runtime workloads:
- **Runtime API Service Account (`rag-api-runtime`)**: Granted `roles/datastore.user` (Firestore read/write), `roles/aiplatform.user` (Vertex AI inference & embeddings), `roles/storage.objectViewer` (read evaluation artifacts), and `roles/logging.logWriter`. Never granted `roles/run.invoker` on itself or `roles/iam.serviceAccountAdmin`.
- **Ingestion Job Service Account (`rag-ingestion-job`)**: Granted `roles/storage.objectViewer` on the corpus bucket, `roles/datastore.user` on the dedicated Firestore database, `roles/aiplatform.user` for batch embedding generation, and `roles/logging.logWriter`.
- **Workflows Orchestrator Service Account (`rag-workflow-runner`)**: Granted `roles/run.invoker` and `roles/run.developer` strictly scoped to trigger the Cloud Run Ingestion Job, plus `roles/logging.logWriter`.
- **Vercel BFF Invoker Service Account (`rag-vercel-bff-invoker`)**: Granted ONLY `roles/run.invoker` on the private RAG API Cloud Run service. Holds zero Firestore, GCS, or Vertex AI permissions.

## 3. Zero Idle Cost & Scaling Limits
To prevent runaway cloud spend in non-high-frequency and portfolio workloads, all Cloud Run v2 services and jobs MUST enforce the Zero Idle Cost Baseline:
- `min_instance_count = 0` (scale to zero when idle)
- `max_instance_count = 2` (hard upper bound to cap burst spend)
- `deletion_protection = false` (enables deterministic Terraform teardown)
- Request timeout: `300s` for synchronous RAG API calls; `900s` for asynchronous batch ingestion jobs.
- Concurrency: `40` concurrent requests per container instance on `1 vCPU / 1 GiB RAM`.

## 4. Secret Handling & Credential Hygiene
Service Account JSON keys used by external Vercel BFF runtimes MUST be stored exclusively in Vercel Encrypted Environment Variables (`GCP_SA_KEY_JSON`) and local developer AppData directories (`%LOCALAPPDATA%`), never committed to Git repositories, never placed in `NEXT_PUBLIC_*` variables, and rotated every 90 days.
