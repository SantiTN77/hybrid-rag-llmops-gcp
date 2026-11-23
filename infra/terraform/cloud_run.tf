# Private Cloud Run v2 Hybrid RAG API Service
# Enforces Zero Idle Cost Policy: min_instance_count = 0, max_instance_count = 2, deletion_protection = false
resource "google_cloud_run_v2_service" "rag_api" {
  project             = var.project_id
  name                = "hybrid-rag-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.rag_api_runtime.email
    timeout         = "300s"

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    max_instance_request_concurrency = 40

    containers {
      image = var.rag_api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      env {
        name  = "GOOGLE_GENAI_USE_VERTEXAI"
        value = "TRUE"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }
      env {
        name  = "VERTEX_EMBEDDING_LOCATION"
        value = var.region
      }
      env {
        name  = "GEMINI_MODEL"
        value = var.gemini_model
      }
      env {
        name  = "EMBEDDING_MODEL"
        value = var.embedding_model
      }
      env {
        name  = "EMBEDDING_DIMENSION"
        value = tostring(var.embedding_dimension)
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = google_firestore_database.hybrid_rag.name
      }
      env {
        name  = "CORPUS_BUCKET"
        value = google_storage_bucket.corpus.name
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 3
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_firestore_index.rag_chunks_vector,
  ]
}

# Strictly Private IAM: ONLY rag-vercel-bff-invoker is granted roles/run.invoker.
# ZERO allUsers or allAuthenticatedUsers bindings.
resource "google_cloud_run_v2_service_iam_member" "vercel_bff_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.rag_api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.rag_vercel_bff_invoker.email}"
}

# Cloud Run v2 Asynchronous Ingestion Job (Zero Idle Cost, runs on demand via Cloud Workflows)
resource "google_cloud_run_v2_job" "ingestion_job" {
  project             = var.project_id
  name                = "hybrid-rag-ingestion-job"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.rag_ingestion_job.email
      max_retries     = 2
      timeout         = "900s"

      containers {
        image = var.ingestion_job_image

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        env {
          name  = "GOOGLE_GENAI_USE_VERTEXAI"
          value = "TRUE"
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "VERTEX_EMBEDDING_LOCATION"
          value = var.region
        }
        env {
          name  = "EMBEDDING_MODEL"
          value = var.embedding_model
        }
        env {
          name  = "EMBEDDING_DIMENSION"
          value = tostring(var.embedding_dimension)
        }
        env {
          name  = "CORPUS_BUCKET"
          value = google_storage_bucket.corpus.name
        }
        env {
          name  = "CORPUS_PREFIX"
          value = "corpus/"
        }
        env {
          name  = "FIRESTORE_DATABASE"
          value = google_firestore_database.hybrid_rag.name
        }
      }
    }
  }

  depends_on = [
    google_project_service.apis,
    google_firestore_index.rag_chunks_vector,
  ]
}
