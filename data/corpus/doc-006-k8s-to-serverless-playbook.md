# GKE Kubernetes to Serverless Cloud Run Migration Playbook
Document ID: doc-006-k8s-to-serverless-playbook
Version: 1.6
Owner: Cloud Modernization Architecture Team
Last Updated: 2026-10-18

## 1. Migration Qualification Criteria
Workloads running on Google Kubernetes Engine (GKE) are strong candidates for migration to Cloud Run v2 when they meet all four criteria:
1. Stateless HTTP/gRPC request-response APIs or short-lived batch jobs (< 60 minutes execution time).
2. Container memory footprint under `32 GiB` and CPU requirement under `8 vCPU`.
3. Bursty or intermittent traffic profiles where GKE node pools sit below **25% average CPU utilization**.
4. No requirement for custom kernel modules, DaemonSets, or persistent local NVMe volumes.

## 2. Batch Workload Mapping: Kubernetes CronJobs to Cloud Run Jobs + Workflows
Stateful or long-running Kubernetes `Job` and `CronJob` manifests map directly to **Cloud Run v2 Jobs** orchestrated by **GCP Cloud Workflows**:
- Cloud Run Jobs execute container entrypoints to completion with configurable `task_count`, `parallelism`, and `max_retries` (recommended `max_retries = 2` for idempotent Firestore upserts).
- Cloud Workflows provides durable, serverless orchestration ($0 idle cost; first 5,000 internal steps/month free) to trigger the ingestion job via `googleapis.run.v2.projects.locations.jobs.run`, poll until completion, and emit structured Cloud Logging telemetry.

## 3. Observed FinOps Savings
Across 14 internal services migrated from GKE Standard to Cloud Run v2 in FY2026, Meridian recorded an average **78% reduction in monthly compute spend**, a **62% reduction in YAML/Terraform maintenance overhead**, and cold-start P95 latencies under **1.8 seconds** for slim Python 3.12 (`uv` + FastAPI) container images under 250 MB.
