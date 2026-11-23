"""Static Terraform & Repo Policy Tests: Zero Idle Cost, Private IAM, Firestore Vector Search, pnpm-only."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TF_DIR = REPO_ROOT / "infra" / "terraform"


def _read_all_tf_code() -> str:
    lines: list[str] = []
    for p in sorted(TF_DIR.glob("*.tf")):
        for line in p.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped.startswith("#"):
                lines.append(line)
    return "\n".join(lines)


def test_zero_idle_cost_and_deletion_protection_policy() -> None:
    tf = _read_all_tf_code()
    assert "min_instance_count = 0" in tf
    assert "max_instance_count = 2" in tf
    assert "deletion_protection = false" in tf
    assert "google_vertex_ai_index_endpoint" not in tf
    assert "google_firestore_index" in tf
    assert "vector_config" in tf


def test_private_cloud_run_iam_forbids_public_invokers() -> None:
    tf = _read_all_tf_code()
    assert "allUsers" not in tf
    assert "allAuthenticatedUsers" not in tf
    assert "rag-vercel-bff-invoker" in tf
    assert 'role     = "roles/run.invoker"' in tf


def test_pnpm_only_enforcement() -> None:
    assert not (REPO_ROOT / "web" / "package-lock.json").exists()
    pkg = (REPO_ROOT / "web" / "package.json").read_text(encoding="utf-8")
    assert '"packageManager": "pnpm@' in pkg
