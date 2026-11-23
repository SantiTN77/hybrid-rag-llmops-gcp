"""Automated LLMOps Evaluation CLI runner against live Private Cloud Run Hybrid RAG API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from google import genai
from google.auth.transport.requests import Request
from google.cloud import firestore, storage
from google.genai import types
from google.oauth2 import service_account

from evaluator.metrics import (
    CaseEvalResult,
    GateThresholds,
    compute_context_precision_at_k,
    compute_context_recall,
    compute_fact_coverage,
    evaluate_gate,
)

JUDGE_SYSTEM_PROMPT = """You are a strict LLMOps Grounding Auditor.
Given a user question, retrieved context chunks, and a generated answer, determine whether the generated answer is strictly grounded in the retrieved context chunks without fabricating unsupported facts.
Respond ONLY with valid JSON: {"grounded": true/false, "reason": "concise 1-sentence justification"}."""


def mint_oidc_token(target_audience: str, sa_key_path: str | None = None) -> str:
    """Mint a Google OIDC ID token for invoking a private Cloud Run service."""
    env_token = os.environ.get("RAG_API_ID_TOKEN", "").strip()
    if env_token:
        return env_token

    key_path = sa_key_path or os.environ.get("GCP_SA_KEY_PATH", "").strip()
    if not key_path:
        raise RuntimeError(
            "Provide --sa-key-path, GCP_SA_KEY_PATH, or RAG_API_ID_TOKEN to invoke private Cloud Run."
        )
    creds = service_account.IDTokenCredentials.from_service_account_file(
        key_path,
        target_audience=target_audience.rstrip("/"),
    )
    creds.refresh(Request())
    if not creds.token:
        raise RuntimeError("Failed to mint OIDC ID token from Service Account key.")
    return str(creds.token)


def judge_grounding(
    judge_client: genai.Client,
    model: str,
    query: str,
    chunks: list[dict[str, Any]],
    answer: str,
) -> tuple[bool, str]:
    context_text = "\n\n".join(f"[{c['chunk_id']}]\n{c['content']}" for c in chunks)
    prompt = (
        f"Question: {query}\n\n"
        f"Retrieved Context:\n{context_text}\n\n"
        f"Generated Answer:\n{answer}\n\n"
        "Is every factual claim in the Generated Answer supported by the Retrieved Context? Return JSON only."
    )
    try:
        resp = judge_client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=JUDGE_SYSTEM_PROMPT,
                temperature=0.0,
                max_output_tokens=1024,
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        raw = (resp.text or "{}").strip()
        parsed = json.loads(raw)
        return bool(parsed.get("grounded", False)), str(parsed.get("reason", "No reason provided"))
    except Exception as exc:
        return False, f"Judge parse/call error: {exc}"


def run_evaluation(
    *,
    api_url: str,
    dataset_path: Path,
    project_id: str,
    firestore_database: str,
    corpus_bucket: str | None,
    sa_key_path: str | None,
    judge_model: str = "gemini-3.8-flash",
    output_path: Path | None = None,
    persist_gcp: bool = True,
) -> dict[str, Any]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    raw_thresholds = dataset.get("gate_thresholds", {})
    thresholds = GateThresholds(
        max_hallucination_rate=float(raw_thresholds.get("max_hallucination_rate", 0.10)),
        min_context_precision=float(raw_thresholds.get("min_context_precision", 0.75)),
        max_avg_cost_per_query_usd=float(raw_thresholds.get("max_avg_cost_per_query_usd", 0.005)),
    )

    id_token = mint_oidc_token(api_url, sa_key_path=sa_key_path)
    headers = {
        "Authorization": f"Bearer {id_token}",
        "Content-Type": "application/json",
    }

    judge_client = genai.Client(
        vertexai=True,
        project=project_id,
        location="global",
    )

    case_results: list[CaseEvalResult] = []
    model_used = judge_model
    embedding_model_used = "gemini-embedding-001"

    with httpx.Client(timeout=60.0) as http:
        for case in dataset["cases"]:
            case_id = str(case["id"])
            query = str(case["query"])
            unanswerable = bool(case.get("unanswerable", False))
            expected_docs = list(case.get("expected_doc_ids", []))
            expected_facts = list(case.get("expected_facts", []))

            resp = http.post(
                f"{api_url.rstrip('/')}/api/query",
                headers={**headers, "X-Trace-Id": f"eval-{case_id}-{uuid.uuid4().hex[:8]}"},
                json={"query": query, "top_k": 5, "vector_weight": 0.60, "lexical_weight": 0.40},
            )
            resp.raise_for_status()
            payload = resp.json()

            answer = str(payload.get("answer", ""))
            abstained = bool(payload.get("abstained", False))
            cited = list(payload.get("cited_chunk_ids", []))
            chunks = list(payload.get("chunks", []))
            retrieved_doc_ids = [str(c.get("doc_id", "")) for c in chunks]
            telemetry = payload.get("telemetry", {})
            model_used = str(telemetry.get("model", model_used))
            embedding_model_used = str(telemetry.get("embedding_model", embedding_model_used))
            cost_usd = float(telemetry.get("cost", {}).get("estimated_cost_usd", 0.0))
            latency_ms = float(telemetry.get("latency_ms", {}).get("total_ms", 0.0))

            if unanswerable:
                hallucinated = not abstained
                reason = (
                    "Correctly abstained on out-of-scope query."
                    if abstained
                    else "Failed to abstain on unanswerable/out-of-scope query."
                )
                ctx_prec = None
                ctx_rec = None
                fact_cov = None
            else:
                ctx_prec = compute_context_precision_at_k(retrieved_doc_ids, expected_docs)
                ctx_rec = compute_context_recall(retrieved_doc_ids, expected_docs)
                fact_cov = compute_fact_coverage(answer, expected_facts)
                if abstained:
                    hallucinated = False
                    reason = "Model abstained conservatively."
                elif not cited:
                    hallucinated = True
                    reason = "Generated answer lacked required [doc_id#chunk] inline citations."
                else:
                    grounded, judge_reason = judge_grounding(
                        judge_client, judge_model, query, chunks, answer
                    )
                    hallucinated = not grounded
                    reason = judge_reason

            case_results.append(
                CaseEvalResult(
                    case_id=case_id,
                    category=str(case.get("category", "factual")),
                    query=query,
                    unanswerable=unanswerable,
                    abstained=abstained,
                    hallucinated=hallucinated,
                    hallucination_reason=reason,
                    context_precision=ctx_prec,
                    context_recall=ctx_rec,
                    fact_coverage=fact_cov,
                    cited_chunk_ids=cited,
                    retrieved_doc_ids=list(dict.fromkeys(retrieved_doc_ids)),
                    expected_doc_ids=expected_docs,
                    cost_usd=cost_usd,
                    latency_ms=latency_ms,
                    answer_preview=answer[:280],
                )
            )

    gate_eval = evaluate_gate(case_results, thresholds)
    run_id = f"eval-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
    report: dict[str, Any] = {
        "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "dataset_version": str(dataset.get("dataset_version", "1.0.0")),
        "model": model_used,
        "embedding_model": embedding_model_used,
        "gate_passed": gate_eval["gate_passed"],
        "thresholds": gate_eval["thresholds"],
        "checks": gate_eval["checks"],
        "summary": gate_eval["summary"],
        "cases": [asdict(c) for c in case_results],
    }

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if persist_gcp:
        db = firestore.Client(project=project_id, database=firestore_database)
        db.collection("evaluation_runs").document(run_id).set(report)
        if corpus_bucket:
            gcs = storage.Client(project=project_id)
            blob = gcs.bucket(corpus_bucket).blob(f"evaluations/{run_id}.json")
            blob.upload_from_string(json.dumps(report, indent=2), content_type="application/json")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Automated LLMOps Evaluation & Quality Gate")
    parser.add_argument("--api-url", required=True, help="Private Cloud Run RAG API base URL")
    parser.add_argument("--dataset", default="data/golden_dataset.json", help="Path to golden dataset JSON")
    parser.add_argument("--project-id", default=os.environ.get("GOOGLE_CLOUD_PROJECT", "gen-lang-client-0527325883"))
    parser.add_argument("--firestore-database", default=os.environ.get("FIRESTORE_DATABASE", "hybrid-rag-db"))
    parser.add_argument("--corpus-bucket", default=os.environ.get("CORPUS_BUCKET", ""))
    parser.add_argument("--sa-key-path", default=os.environ.get("GCP_SA_KEY_PATH", ""))
    parser.add_argument("--output", default="", help="Optional local path to write JSON report")
    parser.add_argument("--no-persist", action="store_true", help="Skip persisting report to Firestore/GCS")
    args = parser.parse_args()

    report = run_evaluation(
        api_url=args.api_url,
        dataset_path=Path(args.dataset),
        project_id=args.project_id,
        firestore_database=args.firestore_database,
        corpus_bucket=args.corpus_bucket or None,
        sa_key_path=args.sa_key_path or None,
        output_path=Path(args.output) if args.output else None,
        persist_gcp=not args.no_persist,
    )

    s = report["summary"]
    print(
        f"[LLMOPS-GATE] run_id={report['run_id']} | GATE={'PASS' if report['gate_passed'] else 'FAIL'} | "
        f"Hallucination={s['hallucination_rate']:.2%} | ContextPrecision={s['context_precision']:.2%} | "
        f"ContextRecall={s['context_recall']:.2%} | AvgCost=${s['avg_cost_per_query_usd']:.6f} | "
        f"AvgLatency={s['avg_latency_ms']:.1f}ms"
    )
    return 0 if report["gate_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
