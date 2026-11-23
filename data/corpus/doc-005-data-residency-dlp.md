# Enterprise Data Residency & Cloud DLP Compliance Standard
Document ID: doc-005-data-residency-dlp
Version: 2.0
Owner: Enterprise Governance, Risk & Compliance (GRC)
Last Updated: 2026-10-05

## 1. Regional Data Residency Requirements
All corpus source files stored in Google Cloud Storage (GCS) and vector chunk indices stored in Cloud Firestore MUST reside in single-region `us-central1` for US-tier enterprise tenants, or `europe-west4` for EU GDPR-regulated tenants. Multi-region buckets (`US`, `EU`) are prohibited for regulated RAG corpora because they do not guarantee deterministic single-zone audit boundaries.

GCS buckets storing technical corpora MUST enforce:
- `uniform_bucket_level_access = true`
- `public_access_prevention = "enforced"`
- Object versioning enabled for rollback of corrupted ingestion batches
- 90-day lifecycle retention rule on non-current object versions.

## 2. Pre-Ingestion PII & Secret Redaction (Cloud DLP)
Before any enterprise document is chunked and embedded into Firestore Vector Search, the ingestion pipeline MUST scan text for sensitive infoTypes including `US_SOCIAL_SECURITY_NUMBER`, `CREDIT_CARD_NUMBER`, `EMAIL_ADDRESS`, and cloud credential patterns (`PRIVATE_KEY`, `API_KEY`).

Detected PII tokens MUST be replaced with deterministic redaction placeholders (e.g., `[REDACTED_SSN]`, `[REDACTED_EMAIL]`) prior to embedding generation so raw PII is never encoded into dense vector representations or logged to Cloud Logging.

## 3. Audit Logging & Retention
Cloud Audit Logs (Admin Read, Data Read, Data Write) for Firestore and GCS MUST be retained for **365 days** in a dedicated compliance log bucket. Query text logged in `rag_query_telemetry` MUST be truncated to 512 characters and scrubbed of bearer tokens or credential strings before emission.
