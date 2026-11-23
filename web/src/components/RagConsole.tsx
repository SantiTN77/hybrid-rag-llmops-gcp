"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  DollarSign,
  FileText,
  Layers,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import type {
  CorpusResponse,
  EvaluationsResponse,
  HealthResponse,
  QueryResponse,
} from "@/lib/types";

interface SampleQuery {
  label: string;
  tag: string;
  query: string;
}

const SAMPLE_QUERIES: SampleQuery[] = [
  {
    label: "Private IAM & BFF Auth",
    tag: "Factual",
    query:
      "What HTTP status codes must a private Cloud Run endpoint return for unauthenticated direct requests, and which Service Account is allowed to invoke it?",
  },
  {
    label: "SEV-1 Incident SLAs",
    tag: "Numeric SLA",
    query:
      "What are the MTTA, MTTM, and executive update intervals for a SEV-1 critical outage?",
  },
  {
    label: "Firestore Vector vs Vertex + RRF",
    tag: "Multi-Hop",
    query:
      "Why did Meridian choose Firestore Vector Search over Vertex AI Vector Search Endpoints, what RRF weights are used, and what are the three LLMOps quality gate thresholds?",
  },
  {
    label: "AWS EKS Budget (Out-of-Scope)",
    tag: "Hallucination Test",
    query:
      "What is Meridian's approved AWS EKS cluster auto-scaling budget and Amazon Bedrock Claude 3.7 pricing rate card?",
  },
];

type RetrievalMode = "hybrid" | "vector" | "lexical";

const MODE_WEIGHTS: Record<RetrievalMode, { vector: number; lexical: number; label: string }> = {
  hybrid: { vector: 0.6, lexical: 0.4, label: "Hybrid RRF (60% Vector / 40% BM25)" },
  vector: { vector: 1.0, lexical: 0.0, label: "Dense Vector Only (Firestore COSINE)" },
  lexical: { vector: 0.0, lexical: 1.0, label: "Lexical Only (Okapi BM25)" },
};

export default function RagConsole() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [corpus, setCorpus] = useState<CorpusResponse | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationsResponse | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const [queryInput, setQueryInput] = useState<string>(SAMPLE_QUERIES[0].query);
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState<number>(5);
  const [loadingQuery, setLoadingQuery] = useState<boolean>(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);

  const loadInitialState = useCallback(async () => {
    try {
      const [hRes, cRes, eRes] = await Promise.all([
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/corpus", { cache: "no-store" }),
        fetch("/api/evaluations", { cache: "no-store" }),
      ]);
      if (hRes.ok) setHealth((await hRes.json()) as HealthResponse);
      if (cRes.ok) setCorpus((await cRes.json()) as CorpusResponse);
      if (eRes.ok) setEvaluations((await eRes.json()) as EvaluationsResponse);
      if (!hRes.ok) {
        setBootstrapError("Private Cloud Run API health check returned non-200.");
      } else {
        setBootstrapError(null);
      }
    } catch (err) {
      setBootstrapError(err instanceof Error ? err.message : "Failed to initialize console.");
    }
  }, []);

  useEffect(() => {
    void loadInitialState();
  }, [loadInitialState]);

  const executeQuery = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? queryInput).trim();
    if (q.length < 3) return;
    setLoadingQuery(true);
    setQueryError(null);
    setHighlightedChunkId(null);

    try {
      const weights = MODE_WEIGHTS[mode];
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          top_k: topK,
          vector_weight: weights.vector,
          lexical_weight: weights.lexical,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data as QueryResponse);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query execution failed.");
    } finally {
      setLoadingQuery(false);
    }
  };

  const renderAnswerWithCitations = (text: string, citedIds: string[]) => {
    const parts = text.split(/(\[doc-[a-zA-Z0-9-]+#\d+\])/g);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(doc-[a-zA-Z0-9-]+#\d+)\]$/);
      if (match) {
        const cid = match[1];
        const isKnown = citedIds.includes(cid);
        return (
          <button
            key={`${cid}-${idx}`}
            type="button"
            onClick={() => setHighlightedChunkId(cid)}
            className={`mx-0.5 inline-flex items-center rounded px-1.5 py-0.5 font-mono text-xs transition ${
              highlightedChunkId === cid
                ? "bg-cyan-400 text-slate-950 font-semibold"
                : isKnown
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30"
                : "bg-slate-800 text-slate-300 border border-slate-700"
            }`}
          >
            {part}
          </button>
        );
      }
      // Render lightweight **bold** markdown emitted by the model without injecting HTML.
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return (
        <span key={idx}>
          {boldParts.map((seg, j) =>
            /^\*\*[^*]+\*\*$/.test(seg) ? (
              <strong key={j} className="font-semibold text-slate-50">
                {seg.slice(2, -2)}
              </strong>
            ) : (
              <span key={j}>{seg}</span>
            )
          )}
        </span>
      );
    });
  };

  const latestEval = evaluations?.latest ?? null;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100">
      {/* Top Enterprise Status Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#0b1120]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30">
              <Layers className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white">
                Enterprise Hybrid RAG &amp; LLMOps Console
              </h1>
              <p className="text-xs text-slate-400">
                GCP Firestore Vector Search (COSINE) + Okapi BM25 + RRF · Vertex AI{" "}
                <span className="text-cyan-300 font-mono">
                  {health?.model ?? "gemini-3.8-flash"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium border ${
                health?.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/30"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  health?.status === "ok" ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {health?.status === "ok" ? "Private Cloud Run Connected (OIDC)" : "Connecting..."}
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 font-medium text-cyan-300">
              <DollarSign className="h-3.5 w-3.5" />
              $0.00 Idle Cost Policy
            </span>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 font-medium text-indigo-300">
              <Lock className="h-3.5 w-3.5" />
              Zero Browser GCP Creds
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {bootstrapError && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{bootstrapError}</span>
          </div>
        )}

        {/* Top KPI Strip */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Indexed Technical Corpus</span>
              <Database className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white">
              {corpus ? `${corpus.document_count} Docs` : "—"}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {corpus
                ? `${corpus.total_chunks} chunks · ${corpus.embedding_dimension}d (${corpus.database})`
                : "Loading Firestore index..."}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>LLMOps Quality Gate</span>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              {latestEval ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-lg font-bold ${
                    latestEval.gate_passed
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {latestEval.gate_passed ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {latestEval.gate_passed ? "PASS" : "FAIL"}
                </span>
              ) : (
                <span className="text-2xl font-bold text-slate-500">—</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {latestEval
                ? `${latestEval.summary.total_cases} golden cases · ${latestEval.run_id}`
                : "No persisted evaluation runs yet"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Hallucination Rate (Gate &le; 10%)</span>
              <Activity className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="mt-2 text-2xl font-bold text-white">
              {latestEval
                ? `${(latestEval.summary.hallucination_rate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {latestEval
                ? `Context Precision@K: ${(latestEval.summary.context_precision * 100).toFixed(1)}%`
                : "Awaiting eval telemetry"}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0d1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Avg Cost / Query (Gate &le; $0.005)</span>
              <DollarSign className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-emerald-300">
              {latestEval
                ? `$${latestEval.summary.avg_cost_per_query_usd.toFixed(6)}`
                : "—"}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {latestEval
                ? `Avg Latency: ${latestEval.summary.avg_latency_ms.toFixed(0)} ms`
                : "FinOps Cloud Logging enabled"}
            </div>
          </div>
        </section>

        {/* Main Workspace: Interactive Query Console + Live Telemetry */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left 2 Columns: Query Input, Answer, Retrieved Chunks */}
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Search className="h-4 w-4 text-cyan-400" />
                  Interactive Hybrid RAG Query Console
                </h2>
                <span className="text-xs text-slate-400">
                  1-click golden &amp; adversarial samples
                </span>
              </div>

              {/* Sample Query Chips */}
              <div className="mb-4 flex flex-wrap gap-2">
                {SAMPLE_QUERIES.map((sq) => (
                  <button
                    key={sq.label}
                    type="button"
                    onClick={() => {
                      setQueryInput(sq.query);
                      void executeQuery(sq.query);
                    }}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 transition hover:border-cyan-500/60 hover:bg-slate-800"
                  >
                    <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                      {sq.tag}
                    </span>
                    <span>{sq.label}</span>
                  </button>
                ))}
              </div>

              {/* Query Textarea & Mode Controls */}
              <div className="space-y-3">
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  rows={3}
                  placeholder="Ask an enterprise architecture, IAM, FinOps, or SLA question..."
                  className="w-full rounded-xl border border-slate-700/80 bg-[#070b14] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(Object.keys(MODE_WEIGHTS) as RetrievalMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition border ${
                          mode === m
                            ? "border-cyan-400/70 bg-cyan-500/20 text-cyan-200"
                            : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {m === "hybrid"
                          ? "Hybrid RRF (0.6/0.4)"
                          : m === "vector"
                          ? "Vector Only"
                          : "BM25 Lexical"}
                      </button>
                    ))}

                    <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-slate-400">
                      Top-K:
                      <select
                        value={topK}
                        onChange={(e) => setTopK(Number(e.target.value))}
                        className="rounded-md border border-slate-700 bg-[#070b14] px-2 py-1 text-xs text-slate-200"
                      >
                        <option value={3}>3</option>
                        <option value={5}>5</option>
                        <option value={8}>8</option>
                      </select>
                    </label>
                  </div>

                  <button
                    type="button"
                    disabled={loadingQuery}
                    onClick={() => void executeQuery()}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Sparkles className="h-4 w-4" />
                    {loadingQuery ? "Running Hybrid Search..." : "Run Hybrid RAG"}
                  </button>
                </div>
              </div>

              {queryError && (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                  {queryError}
                </div>
              )}
            </div>

            {/* Grounded Answer Card */}
            {result && (
              <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Grounded Synthesis ({result.telemetry.model})
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {result.abstained ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 font-medium text-amber-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Hallucination Guard: Abstained
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {result.cited_chunk_ids.length} Inline Citations Verified
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-4 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
                  {renderAnswerWithCitations(result.answer, result.cited_chunk_ids)}
                </div>

                {/* Retrieved Chunks with Vector + BM25 + RRF Scores */}
                <div>
                  <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Retrieved Chunks &amp; RRF Fusion Breakdown (k={result.retrieval_config.rrf_k})
                  </h4>
                  <div className="space-y-2.5">
                    {result.chunks.map((chunk, idx) => {
                      const isHighlighted = highlightedChunkId === chunk.chunk_id;
                      const isCited = result.cited_chunk_ids.includes(chunk.chunk_id);
                      return (
                        <div
                          key={chunk.chunk_id}
                          className={`rounded-xl border p-3.5 transition ${
                            isHighlighted
                              ? "border-cyan-400 bg-cyan-500/10"
                              : isCited
                              ? "border-slate-700 bg-[#0a101e]"
                              : "border-slate-800/80 bg-[#080d18]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                                #{idx + 1}
                              </span>
                              <span className="font-mono text-xs font-semibold text-cyan-300">
                                [{chunk.chunk_id}]
                              </span>
                              <span className="text-xs text-slate-300 font-medium">
                                {chunk.section}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                              <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-indigo-300">
                                Vec: {chunk.vector_score !== null ? chunk.vector_score.toFixed(3) : "—"}
                              </span>
                              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300">
                                BM25: {chunk.bm25_score.toFixed(2)}
                              </span>
                              <span className="rounded bg-cyan-500/20 px-2 py-0.5 font-semibold text-cyan-200">
                                RRF: {chunk.rrf_score.toFixed(4)}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-400 line-clamp-3">
                            {chunk.content}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Cost/Latency Telemetry + Security Posture */}
          <div className="space-y-6">
            {/* Live Per-Query FinOps & Latency Telemetry */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
                <Cpu className="h-4 w-4 text-emerald-400" />
                Live Query FinOps &amp; Latency Telemetry
              </h3>

              {result ? (
                <div className="space-y-4 text-xs">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <div className="text-emerald-200/80">Estimated Query Cost (USD)</div>
                    <div className="mt-1 font-mono text-xl font-bold text-emerald-300">
                      ${result.telemetry.cost.estimated_cost_usd.toFixed(6)}
                    </div>
                    <div className="mt-1 text-[11px] text-emerald-200/70">
                      Prompt: {result.telemetry.cost.prompt_tokens} tok · Output:{" "}
                      {result.telemetry.cost.completion_tokens} tok · Embed:{" "}
                      {result.telemetry.cost.embedding_tokens} tok
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Latency Breakdown ({result.telemetry.latency_ms.total_ms.toFixed(0)} ms)
                    </div>
                    {[
                      { label: "Vertex AI Embedding", ms: result.telemetry.latency_ms.embedding_ms },
                      {
                        label: "Firestore Vector Search",
                        ms: result.telemetry.latency_ms.vector_search_ms,
                      },
                      { label: "Okapi BM25 Lexical", ms: result.telemetry.latency_ms.lexical_search_ms },
                      {
                        label: "Gemini 3.8 Flash Synthesis",
                        ms: result.telemetry.latency_ms.generation_ms,
                      },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between text-slate-300">
                        <span>{row.label}</span>
                        <span className="font-mono text-cyan-300">{row.ms.toFixed(1)} ms</span>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-slate-800 bg-[#070b14] p-2.5 font-mono text-[11px] text-slate-400">
                    <div>Cloud Logging Event: {result.telemetry.cloud_logging_event}</div>
                    <div className="truncate text-slate-300">Trace: {result.trace_id}</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Execute a Hybrid RAG query to inspect live per-query token usage, exact USD cost
                  calculation, Firestore Vector vs BM25 latency breakdown, and Cloud Logging trace
                  correlation.
                </p>
              )}
            </div>

            {/* Zero-Idle-Cost & Private IAM Security Posture */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="h-4 w-4 text-indigo-400" />
                Zero-Idle-Cost &amp; Private IAM Posture
              </h3>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>
                    <strong>Firestore Vector Search</strong> (<code>hybrid-rag-db</code>, 768d FLAT
                    COSINE) — $0.00 idle cost (no always-on Vertex Vector Endpoints).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>
                    <strong>Private Cloud Run v2 API</strong> — <code>min_instance_count=0</code>,{" "}
                    <code>max_instance_count=2</code>; unauth requests return HTTP 403.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>
                    <strong>Server-Side OIDC BFF</strong> — Vercel API routes mint short-lived
                    Google ID tokens via scoped <code>rag-vercel-bff-invoker</code> SA.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>
                    <strong>Cloud Workflows + Cloud Run Job</strong> — Serverless asynchronous GCS
                    ingestion with pre-embedding PII redaction.
                  </span>
                </li>
              </ul>
            </div>

            {/* Indexed Corpus Summary */}
            <div className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileText className="h-4 w-4 text-cyan-400" />
                Indexed Corpus Inventory ({corpus?.document_count ?? 0})
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {corpus?.documents.map((doc) => (
                  <div
                    key={doc.doc_id}
                    className="rounded-lg border border-slate-800/90 bg-[#070b14] px-3 py-2 text-xs"
                  >
                    <div className="font-medium text-slate-200 truncate">{doc.title}</div>
                    <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-slate-400">
                      <span>{doc.doc_id}</span>
                      <span>{doc.chunk_count} chunks</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Automated LLMOps Evaluation Gate Dashboard */}
        <section className="rounded-2xl border border-slate-800 bg-[#0d1424] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Automated LLMOps Pre-Deployment Quality Gate Report
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live persisted golden-dataset evaluation from Firestore (<code>evaluation_runs</code>)
                verifying Hallucination Rate, Context Precision@K, Abstention Accuracy, and FinOps Cost.
              </p>
            </div>
            {latestEval && (
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-slate-400">Run: {latestEval.run_id}</span>
                <span
                  className={`rounded-full px-3 py-1 font-semibold border ${
                    latestEval.gate_passed
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                  }`}
                >
                  GATE: {latestEval.gate_passed ? "PASSED" : "FAILED"}
                </span>
              </div>
            )}
          </div>

          {latestEval ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <div className="text-slate-400">Hallucination Rate</div>
                  <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
                    {(latestEval.summary.hallucination_rate * 100).toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Threshold &le; {(latestEval.thresholds.max_hallucination_rate * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <div className="text-slate-400">Context Precision@K</div>
                  <div className="mt-1 font-mono text-lg font-bold text-cyan-300">
                    {(latestEval.summary.context_precision * 100).toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Threshold &ge; {(latestEval.thresholds.min_context_precision * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <div className="text-slate-400">Context Recall@K</div>
                  <div className="mt-1 font-mono text-lg font-bold text-indigo-300">
                    {(latestEval.summary.context_recall * 100).toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-500">Expected doc coverage</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <div className="text-slate-400">Unanswerable Abstention</div>
                  <div className="mt-1 font-mono text-lg font-bold text-amber-300">
                    {(latestEval.summary.abstention_accuracy * 100).toFixed(0)}%
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {latestEval.summary.unanswerable_cases} negative probes
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                  <div className="text-slate-400">Avg / P95 Cost (USD)</div>
                  <div className="mt-1 font-mono text-lg font-bold text-emerald-300">
                    ${latestEval.summary.avg_cost_per_query_usd.toFixed(5)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    P95: ${latestEval.summary.p95_cost_per_query_usd.toFixed(5)}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 uppercase text-[11px]">
                    <tr>
                      <th className="px-3 py-2.5">Case</th>
                      <th className="px-3 py-2.5">Category</th>
                      <th className="px-3 py-2.5">Query</th>
                      <th className="px-3 py-2.5">Grounding</th>
                      <th className="px-3 py-2.5">Precision</th>
                      <th className="px-3 py-2.5">Cost (USD)</th>
                      <th className="px-3 py-2.5">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-[#070b14]">
                    {latestEval.cases.map((c) => (
                      <tr key={c.case_id} className="hover:bg-slate-900/50">
                        <td className="px-3 py-2 font-mono text-cyan-300 whitespace-nowrap">
                          {c.case_id}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                            {c.category}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300 max-w-md truncate" title={c.query}>
                          {c.query}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {c.hallucinated ? (
                            <span className="text-rose-400 font-semibold">Hallucinated</span>
                          ) : c.unanswerable ? (
                            <span className="text-amber-300 font-medium">Abstained OK</span>
                          ) : (
                            <span className="text-emerald-400 font-medium">Grounded</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">
                          {c.context_precision !== null
                            ? `${(c.context_precision * 100).toFixed(0)}%`
                            : "N/A"}
                        </td>
                        <td className="px-3 py-2 font-mono text-emerald-300 whitespace-nowrap">
                          ${c.cost_usd.toFixed(6)}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                          {c.latency_ms.toFixed(0)} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-[#070b14] p-6 text-center text-xs text-slate-400">
              No evaluation runs persisted yet. Run the Automated LLMOps Evaluator to populate this
              dashboard.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
