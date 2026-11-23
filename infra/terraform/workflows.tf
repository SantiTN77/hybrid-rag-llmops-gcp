# GCP Cloud Workflow orchestrating asynchronous Cloud Run v2 Ingestion Job execution
resource "google_workflows_workflow" "ingest_and_eval" {
  project         = var.project_id
  name            = "hybrid-rag-ingest-workflow"
  region          = var.region
  description     = "Triggers Cloud Run v2 Hybrid RAG Ingestion Job and logs structured telemetry"
  service_account = google_service_account.rag_workflow_runner.id
  source_contents = file("${path.module}/../../workflows/ingest_and_eval.yaml")

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_job.ingestion_job,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "workflow_run_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.ingestion_job.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.rag_workflow_runner.email}"
}

resource "google_cloud_run_v2_job_iam_member" "workflow_run_developer" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.ingestion_job.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.rag_workflow_runner.email}"
}

resource "google_project_iam_member" "workflow_run_viewer" {
  project = var.project_id
  role    = "roles/run.viewer"
  member  = "serviceAccount:${google_service_account.rag_workflow_runner.email}"
}

resource "google_project_iam_member" "workflow_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.rag_workflow_runner.email}"
}

# Cloud Logging structured log-based distribution metric for per-query USD cost governance
resource "google_logging_metric" "rag_query_cost_usd" {
  project     = var.project_id
  name        = "hybrid_rag_query_cost_usd"
  description = "Distribution of estimated per-query USD cost emitted by Hybrid RAG API"
  filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"hybrid-rag-api\" AND jsonPayload.event_type=\"rag_query_telemetry\""

  value_extractor = "EXTRACT(jsonPayload.estimated_cost_usd)"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }

  bucket_options {
    exponential_buckets {
      num_finite_buckets = 16
      growth_factor      = 2.0
      scale              = 0.00005
    }
  }

  depends_on = [google_project_service.apis]
}
