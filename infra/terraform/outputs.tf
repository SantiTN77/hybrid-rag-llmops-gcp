output "rag_api_url" {
  description = "Private Cloud Run v2 Hybrid RAG API URL (requires OIDC ID token)"
  value       = google_cloud_run_v2_service.rag_api.uri
}

output "ingestion_job_name" {
  description = "Cloud Run v2 Ingestion Job name"
  value       = google_cloud_run_v2_job.ingestion_job.name
}

output "workflow_name" {
  description = "Cloud Workflow name for asynchronous ingestion orchestration"
  value       = google_workflows_workflow.ingest_and_eval.name
}

output "corpus_bucket_name" {
  description = "GCS bucket storing synthetic technical corpus and evaluation archives"
  value       = google_storage_bucket.corpus.name
}

output "firestore_database_name" {
  description = "Dedicated Firestore Native database ID with Vector Search index"
  value       = google_firestore_database.hybrid_rag.name
}

output "vercel_bff_invoker_email" {
  description = "Scoped Service Account email granted roles/run.invoker on the private RAG API"
  value       = google_service_account.rag_vercel_bff_invoker.email
}
