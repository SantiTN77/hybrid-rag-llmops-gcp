variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "gen-lang-client-0527325883"
}

variable "region" {
  description = "GCP primary region for Cloud Run, Firestore, GCS, and Workflows"
  type        = string
  default     = "us-central1"
}

variable "artifact_registry_repo" {
  description = "Artifact Registry Docker repository name"
  type        = string
  default     = "hybrid-rag-llmops-gcp"
}

variable "firestore_database_id" {
  description = "Dedicated named Firestore Native database ID"
  type        = string
  default     = "hybrid-rag-db"
}

variable "rag_api_image" {
  description = "Container image URI for the Private Cloud Run Hybrid RAG API"
  type        = string
  default     = "us-central1-docker.pkg.dev/gen-lang-client-0527325883/hybrid-rag-llmops-gcp/hybrid-rag-api:latest"
}

variable "ingestion_job_image" {
  description = "Container image URI for the Cloud Run v2 Ingestion Job"
  type        = string
  default     = "us-central1-docker.pkg.dev/gen-lang-client-0527325883/hybrid-rag-llmops-gcp/hybrid-rag-ingestion-job:latest"
}

variable "gemini_model" {
  description = "Vertex AI Gemini model ID"
  type        = string
  default     = "gemini-3.8-flash"
}

variable "embedding_model" {
  description = "Vertex AI embedding model ID"
  type        = string
  default     = "gemini-embedding-001"
}

variable "embedding_dimension" {
  description = "Vector embedding dimension (must be <= 2048 for Firestore Vector Search)"
  type        = number
  default     = 768
}
