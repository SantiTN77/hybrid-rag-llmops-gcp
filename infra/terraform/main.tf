terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0.0"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

locals {
  required_apis = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "aiplatform.googleapis.com",
    "workflows.googleapis.com",
    "logging.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
  ])
  corpus_bucket_name = "${var.project_id}-hybrid-rag-corpus"
}

resource "google_project_service" "apis" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Artifact Registry Docker repository
resource "google_artifact_registry_repository" "containers" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_registry_repo
  description   = "Container images for Enterprise Hybrid RAG & LLMOps pipeline"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# Single-region GCS bucket for synthetic technical corpus & evaluation archival
resource "google_storage_bucket" "corpus" {
  project                     = var.project_id
  name                        = local.corpus_bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 5
      days_since_noncurrent_time = 90
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.apis]
}

# Dedicated named Firestore Native Database ($0.00 idle cost)
resource "google_firestore_database" "hybrid_rag" {
  project                           = var.project_id
  name                              = var.firestore_database_id
  location_id                       = var.region
  type                              = "FIRESTORE_NATIVE"
  concurrency_mode                  = "OPTIMISTIC"
  app_engine_integration_mode       = "DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_DISABLED"
  deletion_policy                   = "DELETE"

  depends_on = [google_project_service.apis]
}

# Firestore Vector Index for COSINE find_nearest queries on rag_chunks.embedding (768-dim)
resource "google_firestore_index" "rag_chunks_vector" {
  project     = var.project_id
  database    = google_firestore_database.hybrid_rag.name
  collection  = "rag_chunks"
  query_scope = "COLLECTION"

  fields {
    field_path = "embedding"
    vector_config {
      dimension = var.embedding_dimension
      flat {}
    }
  }

  lifecycle {
    ignore_changes = [fields]
  }

  depends_on = [google_firestore_database.hybrid_rag]
}

# --- Least-Privilege Service Accounts ---

resource "google_service_account" "rag_api_runtime" {
  project      = var.project_id
  account_id   = "rag-api-runtime"
  display_name = "Hybrid RAG API Runtime Service Account"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "rag_ingestion_job" {
  project      = var.project_id
  account_id   = "rag-ingestion-job"
  display_name = "Hybrid RAG Ingestion Job Service Account"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "rag_workflow_runner" {
  project      = var.project_id
  account_id   = "rag-workflow-runner"
  display_name = "Hybrid RAG Cloud Workflows Orchestrator SA"
  depends_on   = [google_project_service.apis]
}

resource "google_service_account" "rag_vercel_bff_invoker" {
  project      = var.project_id
  account_id   = "rag-vercel-bff-invoker"
  display_name = "Scoped Vercel BFF OIDC Invoker for Private Hybrid RAG API"
  depends_on   = [google_project_service.apis]
}

# --- Runtime IAM Bindings ---

resource "google_project_iam_member" "rag_api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.rag_api_runtime.email}"
}

resource "google_project_iam_member" "rag_api_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.rag_api_runtime.email}"
}

resource "google_project_iam_member" "rag_api_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.rag_api_runtime.email}"
}

resource "google_storage_bucket_iam_member" "rag_api_corpus_viewer" {
  bucket = google_storage_bucket.corpus.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.rag_api_runtime.email}"
}

# --- Ingestion Job IAM Bindings ---

resource "google_project_iam_member" "ingestion_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.rag_ingestion_job.email}"
}

resource "google_project_iam_member" "ingestion_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.rag_ingestion_job.email}"
}

resource "google_project_iam_member" "ingestion_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.rag_ingestion_job.email}"
}

resource "google_storage_bucket_iam_member" "ingestion_corpus_viewer" {
  bucket = google_storage_bucket.corpus.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.rag_ingestion_job.email}"
}
