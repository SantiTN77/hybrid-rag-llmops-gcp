"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowRight, Check, CornerDownLeft, Github, ShieldCheck, X } from "lucide-react";
import type { CorpusResponse, EvaluationsResponse, HealthResponse, QueryResponse } from "@/lib/types";

const EASE = [0.16, 1, 0.3, 1] as const;
const REPO = "https://github.com/SantiTN77/hybrid-rag-llmops-gcp";

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
    query: "What are the MTTA, MTTM, and executive update intervals for a SEV-1 critical outage?",
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

const MODE_WEIGHTS: Record<RetrievalMode, { vector: number; lexical: number; short: string }> = {
  hybrid: { vector: 0.6, lexical: 0.4, short: "Hybrid RRF 0.6 / 0.4" },
  vector: { vector: 1.0, lexical: 0.0, short: "Vector only" },
  lexical: { vector: 0.0, lexical: 1.0, short: "BM25 only" },
};

const PIPELINE = ["Embed query", "Firestore vector search", "BM25 lexical", "RRF fusion", "Gemini synthesis"];

/* ------------------------------------------------------------------ primitives */

function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="relative inline-flex rounded-full border border-line bg-paper p-0.5 text-xs">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`relative z-10 rounded-full px-3 py-1.5 transition-colors duration-300 ${
              active ? "text-paper" : "text-ink-muted hover:text-ink"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-ink"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Bar({ value, tone = "ink", delay = 0 }: { value: number; tone?: "ink" | "accent" | "muted"; delay?: number }) {
  const color = tone === "accent" ? "bg-accent" : tone === "muted" ? "bg-ink-faint" : "bg-ink";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-paper-deep">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      />
    </div>
  );
}

function Pipeline({ running }: { running: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!running) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, PIPELINE.length - 1)), 1100);
    return () => clearInterval(id);
  }, [running]);
  return (
    <ol className="grid grid-cols-5 gap-2">
      {PIPELINE.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="min-w-0">
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: done ? "100%" : current ? "60%" : "0%" }}
                transition={{ duration: current ? 1.1 : 0.4, ease: "linear" }}
              />
            </div>
            <p className={`mt-2 truncate font-mono text-[10px] ${done || current ? "text-ink" : "text-ink-faint"}`}>
              {String(i + 1).padStart(2, "0")} {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ console */

export default function RagConsole() {
  const reduce = useReducedMotion();
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
      setBootstrapError(hRes.ok ? null : "Private Cloud Run API health check returned non-200.");
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
        body: JSON.stringify({ query: q, top_k: topK, vector_weight: weights.vector, lexical_weight: weights.lexical }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data as QueryResponse);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query execution failed.");
    } finally {
      setLoadingQuery(false);
    }
  };

  const renderAnswerWithCitations = (text: string, citedIds: string[]) => {
    const CITE = /(\[doc-[a-zA-Z0-9-]+#\d+(?:\s*,\s*doc-[a-zA-Z0-9-]+#\d+)*\])/g;
    return text.split(CITE).map((part, idx) => {
      if (/^\[doc-[a-zA-Z0-9-]+#\d+(?:\s*,\s*doc-[a-zA-Z0-9-]+#\d+)*\]$/.test(part)) {
        const ids = part.slice(1, -1).split(/\s*,\s*/);
        return (
          <span key={`cite-${idx}`}>
            {ids.map((cid) => {
              const known = citedIds.includes(cid);
              const on = highlightedChunkId === cid;
              return (
                <button
                  key={`${cid}-${idx}`}
                  type="button"
                  onClick={() => setHighlightedChunkId(cid)}
                  className={`mx-0.5 inline-flex items-center rounded-md px-1.5 py-px align-baseline font-mono text-[11px] transition-colors duration-300 ${
                    on
                      ? "bg-accent text-paper"
                      : known
                        ? "bg-accent-soft text-accent hover:bg-accent hover:text-paper"
                        : "bg-paper-deep text-ink-muted"
                  }`}
                >
                  {cid}
                </button>
              );
            })}
          </span>
        );
      }
      const segs = part.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return (
        <span key={idx}>
          {segs.map((seg, j) =>
            /^\*\*[^*]+\*\*$/.test(seg) ? (
              <strong key={j} className="font-semibold text-ink">
                {seg.slice(2, -2)}
              </strong>
            ) : /^`[^`]+`$/.test(seg) ? (
              <code key={j} className="rounded bg-paper-deep px-1 py-0.5 font-mono text-[0.85em] text-ink">
                {seg.slice(1, -1)}
              </code>
            ) : (
              <span key={j}>{seg}</span>
            ),
          )}
        </span>
      );
    });
  };

  const latestEval = evaluations?.latest ?? null;
  const ok = health?.status === "ok";
  const maxRrf = result ? Math.max(...result.chunks.map((c) => c.rrf_score), 1e-9) : 1;
  const maxBm25 = result ? Math.max(...result.chunks.map((c) => c.bm25_score), 1e-9) : 1;

  const fade = (delay = 0) =>
    reduce
      ? {}
      : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease: EASE, delay } };

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------------- header */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-[15px] font-medium tracking-tight">
              Hybrid RAG <span className="font-serif text-lg italic text-accent">&amp;</span> LLMOps Console
            </h1>
            <span className="hidden font-mono text-[11px] text-ink-muted md:inline">{health?.model ?? "gemini-3.8-flash"}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="hidden items-center gap-2 text-ink-muted sm:inline-flex">
              <span className="relative flex h-2 w-2">
                {ok ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok/50" /> : null}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${ok ? "bg-ok" : "bg-warn"}`} />
              </span>
              {ok ? "Private Cloud Run · OIDC" : "Connecting…"}
            </span>
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-ink transition-colors hover:border-ink"
            >
              <Github className="h-3.5 w-3.5" /> Source
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-5 pb-24 sm:px-8">
        {/* ---------------------------------------------------------------- intro */}
        <section className="grid grid-cols-12 gap-6 pb-10 pt-12 md:pt-16">
          <motion.div {...fade()} className="col-span-12 lg:col-span-8">
            <p className="eyebrow">Firestore Vector Search · Okapi BM25 · Reciprocal Rank Fusion</p>
            <h2 className="mt-4 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.035em] md:text-6xl">
              Answers grounded in your corpus — <span className="font-serif italic text-accent">or none at all.</span>
            </h2>
          </motion.div>
          <motion.p {...fade(0.1)} className="col-span-12 self-end text-pretty text-[15px] leading-relaxed text-ink-muted lg:col-span-4">
            Every answer cites the exact chunks it used. Every release must pass a golden-dataset gate on hallucination,
            precision and cost before it ships.
          </motion.p>
        </section>

        {bootstrapError ? (
          <div className="mb-6 flex items-center gap-2 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {bootstrapError}
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- KPIs */}
        <section data-demo="kpis" className="grid grid-cols-2 border-y border-line lg:grid-cols-4">
          {[
            {
              label: "Indexed corpus",
              value: corpus ? `${corpus.document_count} Docs` : "—",
              sub: corpus ? `${corpus.total_chunks} chunks · ${corpus.embedding_dimension}d` : "Loading index…",
            },
            {
              label: "LLMOps quality gate",
              value: latestEval ? (latestEval.gate_passed ? "PASS" : "FAIL") : "—",
              sub: latestEval ? `${latestEval.summary.total_cases} golden cases` : "No runs yet",
              tone: latestEval ? (latestEval.gate_passed ? "text-ok" : "text-bad") : "",
            },
            {
              label: "Hallucination rate · gate ≤ 10%",
              value: latestEval ? `${(latestEval.summary.hallucination_rate * 100).toFixed(1)}%` : "—",
              sub: latestEval ? `Precision@K ${(latestEval.summary.context_precision * 100).toFixed(1)}%` : "Awaiting telemetry",
            },
            {
              label: "Avg cost / query · gate ≤ $0.005",
              value: latestEval ? `$${latestEval.summary.avg_cost_per_query_usd.toFixed(5)}` : "—",
              sub: latestEval ? `Avg latency ${latestEval.summary.avg_latency_ms.toFixed(0)} ms` : "FinOps logging on",
            },
          ].map((k, i) => (
            <motion.div
              key={k.label}
              {...fade(0.15 + i * 0.06)}
              className={`px-1 py-6 sm:px-5 ${i > 0 ? "lg:border-l" : ""} ${i % 2 === 1 ? "border-l lg:border-l" : ""} ${i > 1 ? "border-t lg:border-t-0" : ""} border-line`}
            >
              <p className="eyebrow !text-[10px]">{k.label}</p>
              <p className={`mt-3 font-serif text-4xl leading-none md:text-5xl ${k.tone ?? ""}`}>{k.value}</p>
              <p className="mt-2 font-mono text-[11px] text-ink-muted">{k.sub}</p>
            </motion.div>
          ))}
        </section>

        {/* ---------------------------------------------------------------- workspace */}
        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-8">
            {/* composer */}
            <motion.div {...fade(0.2)} className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-medium tracking-tight">Ask the corpus</h3>
                <span className="eyebrow">Golden & adversarial samples</span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SAMPLE_QUERIES.map((sq) => (
                  <button
                    key={sq.label}
                    type="button"
                    onClick={() => {
                      setQueryInput(sq.query);
                      void executeQuery(sq.query);
                    }}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-paper/60 px-3.5 py-3 text-left transition-all duration-300 hover:-translate-y-px hover:border-ink"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[10px] uppercase tracking-wider text-accent">{sq.tag}</span>
                      <span className="mt-0.5 block truncate text-sm text-ink">{sq.label}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition-all duration-500 ease-[var(--ease-expo)] group-hover:translate-x-0.5 group-hover:text-ink" />
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-line bg-paper/60 focus-within:border-ink">
                <textarea
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void executeQuery();
                  }}
                  rows={3}
                  placeholder="Ask an architecture, IAM, FinOps or SLA question…"
                  className="w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Segmented
                      id="mode"
                      value={mode}
                      onChange={setMode}
                      options={(Object.keys(MODE_WEIGHTS) as RetrievalMode[]).map((m) => ({ value: m, label: MODE_WEIGHTS[m].short }))}
                    />
                    <Segmented
                      id="topk"
                      value={topK}
                      onChange={setTopK}
                      options={[3, 5, 8].map((n) => ({ value: n, label: `k=${n}` }))}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={loadingQuery}
                    onClick={() => void executeQuery()}
                    className="group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-transform duration-300 hover:-translate-y-px disabled:cursor-wait disabled:opacity-70"
                  >
                    {loadingQuery ? "Retrieving…" : "Run Hybrid RAG"}
                    <CornerDownLeft className="h-3.5 w-3.5 opacity-70" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {loadingQuery ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <div className="pt-5">
                      <Pipeline running={loadingQuery} />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {queryError ? (
                <div className="mt-4 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{queryError}</div>
              ) : null}
            </motion.div>

            {/* answer */}
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  key={result.trace_id}
                  data-demo="answer"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.7, ease: EASE }}
                  className="card overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
                    <h3 className="text-lg font-medium tracking-tight">
                      Grounded Synthesis <span className="font-mono text-xs text-ink-muted">· {result.telemetry.model}</span>
                    </h3>
                    {result.abstained ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn">
                        <ShieldCheck className="h-3.5 w-3.5" /> Hallucination guard · abstained
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-xs font-medium text-ok">
                        <Check className="h-3.5 w-3.5" /> {result.cited_chunk_ids.length} {result.cited_chunk_ids.length === 1 ? "citation" : "citations"} verified
                      </span>
                    )}
                  </div>

                  <div className="whitespace-pre-wrap px-5 py-5 text-[15px] leading-[1.75] text-ink-soft sm:px-6">
                    {renderAnswerWithCitations(result.answer, result.cited_chunk_ids)}
                  </div>

                  <div className="border-t border-line px-5 py-5 sm:px-6">
                    <div className="mb-3 flex items-baseline justify-between">
                      <p className="eyebrow">Retrieved chunks · RRF fusion (k={result.retrieval_config.rrf_k})</p>
                      <p className="hidden font-mono text-[10px] text-ink-faint sm:block">vector · bm25 · rrf</p>
                    </div>
                    <ol className="divide-y divide-line">
                      {result.chunks.map((chunk, idx) => {
                        const on = highlightedChunkId === chunk.chunk_id;
                        const cited = result.cited_chunk_ids.includes(chunk.chunk_id);
                        return (
                          <motion.li
                            key={chunk.chunk_id}
                            layout
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.6, ease: EASE, delay: 0.1 + idx * 0.05 }}
                            onClick={() => setHighlightedChunkId(chunk.chunk_id)}
                            className={`grid cursor-pointer grid-cols-12 gap-3 rounded-lg py-3 transition-colors duration-300 ${
                              on ? "bg-accent-soft/60 px-3" : "px-0 hover:bg-paper/70"
                            }`}
                          >
                            <div className="col-span-12 sm:col-span-7">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-ink-faint">{String(idx + 1).padStart(2, "0")}</span>
                                <span className={`font-mono text-xs ${cited ? "text-accent" : "text-ink-muted"}`}>{chunk.chunk_id}</span>
                                <span className="truncate text-xs text-ink-muted">{chunk.section}</span>
                              </div>
                              <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">{chunk.content}</p>
                            </div>
                            <div className="col-span-12 grid grid-cols-3 gap-3 self-center sm:col-span-5">
                              {[
                                { k: "vec", v: chunk.vector_score ?? 0, label: chunk.vector_score !== null ? chunk.vector_score.toFixed(3) : "—", tone: "muted" as const },
                                { k: "bm25", v: chunk.bm25_score / maxBm25, label: chunk.bm25_score.toFixed(2), tone: "muted" as const },
                                { k: "rrf", v: chunk.rrf_score / maxRrf, label: chunk.rrf_score.toFixed(4), tone: "accent" as const },
                              ].map((s) => (
                                <div key={s.k}>
                                  <div className="mb-1 flex justify-between font-mono text-[10px] text-ink-muted">
                                    <span>{s.k}</span>
                                    <span className="text-ink">{s.label}</span>
                                  </div>
                                  <Bar value={s.v} tone={s.tone} delay={0.2 + idx * 0.05} />
                                </div>
                              ))}
                            </div>
                          </motion.li>
                        );
                      })}
                    </ol>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* ---------------------------------------------------------------- side */}
          <aside className="space-y-6 lg:col-span-4">
            <motion.div {...fade(0.25)} data-demo="telemetry" className="card p-5 sm:p-6">
              <p className="eyebrow">Live Query FinOps &amp; Latency</p>
              {result ? (
                <div className="mt-4">
                  <p className="font-serif text-5xl leading-none">${result.telemetry.cost.estimated_cost_usd.toFixed(6)}</p>
                  <p className="mt-2 font-mono text-[11px] text-ink-muted">
                    {result.telemetry.cost.prompt_tokens} in · {result.telemetry.cost.completion_tokens} out ·{" "}
                    {result.telemetry.cost.embedding_tokens} embed tokens
                  </p>

                  {(() => {
                    const l = result.telemetry.latency_ms;
                    const rows = [
                      { label: "Vertex AI embedding", ms: l.embedding_ms, c: "bg-ink-faint" },
                      { label: "Firestore vector search", ms: l.vector_search_ms, c: "bg-ink-muted" },
                      { label: "Okapi BM25 lexical", ms: l.lexical_search_ms, c: "bg-line-strong" },
                      { label: "Gemini synthesis", ms: l.generation_ms, c: "bg-accent" },
                    ];
                    const total = Math.max(rows.reduce((a, r) => a + r.ms, 0), 1);
                    return (
                      <div className="mt-6">
                        <div className="flex items-baseline justify-between">
                          <p className="text-sm font-medium">Latency</p>
                          <p className="font-mono text-xs">{l.total_ms.toFixed(0)} ms</p>
                        </div>
                        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-paper-deep">
                          {rows.map((r, i) => (
                            <motion.div
                              key={r.label}
                              className={`h-full ${r.c}`}
                              initial={{ width: 0 }}
                              animate={{ width: `${(r.ms / total) * 100}%` }}
                              transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.08 }}
                            />
                          ))}
                        </div>
                        <ul className="mt-3 space-y-1.5">
                          {rows.map((r) => (
                            <li key={r.label} className="flex items-center justify-between text-xs text-ink-soft">
                              <span className="flex items-center gap-2">
                                <span className={`h-2 w-2 rounded-full ${r.c}`} />
                                {r.label}
                              </span>
                              <span className="font-mono text-ink">{r.ms.toFixed(1)} ms</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}

                  <div className="mt-5 rounded-lg bg-paper-deep/70 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-muted">
                    <div>event · {result.telemetry.cloud_logging_event}</div>
                    <div className="truncate">trace · {result.trace_id}</div>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                  Run a query to see per-query token usage, exact USD cost, the latency split between embedding, vector
                  search, BM25 and generation, and the Cloud Logging trace.
                </p>
              )}
            </motion.div>

            <motion.div {...fade(0.3)} className="card p-5 sm:p-6">
              <p className="eyebrow">Zero idle cost · private IAM</p>
              <ul className="mt-4 divide-y divide-line">
                {[
                  ["Firestore Vector Search", "768d flat COSINE index — no always-on vector endpoint, $0 idle."],
                  ["Private Cloud Run v2", "min 0 / max 2 instances; unauthenticated calls get HTTP 403."],
                  ["Server-side OIDC BFF", "Short-lived Google ID tokens minted per request by a scoped SA."],
                  ["Workflows + Cloud Run Job", "Async GCS ingestion with PII redaction before embedding."],
                ].map(([t, d]) => (
                  <li key={t} className="py-3 first:pt-0 last:pb-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Check className="h-3.5 w-3.5 text-ok" /> {t}
                    </p>
                    <p className="mt-1 pl-5.5 text-xs leading-relaxed text-ink-muted">{d}</p>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div {...fade(0.35)} className="card p-5 sm:p-6">
              <p className="eyebrow">Indexed corpus · {corpus?.document_count ?? 0} documents</p>
              <ul className="mt-3 max-h-72 divide-y divide-line overflow-y-auto pr-1">
                {corpus?.documents.map((doc) => (
                  <li key={doc.doc_id} className="py-2.5">
                    <p className="truncate text-[13px] text-ink">{doc.title}</p>
                    <p className="mt-0.5 flex justify-between font-mono text-[10.5px] text-ink-muted">
                      <span className="truncate">{doc.doc_id}</span>
                      <span>{doc.chunk_count} chunks</span>
                    </p>
                  </li>
                ))}
              </ul>
            </motion.div>
          </aside>
        </section>

        {/* ---------------------------------------------------------------- gate */}
        <section data-demo="gate" className="mt-16">
          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ink pt-5">
            <div>
              <p className="eyebrow">Pre-deployment quality gate</p>
              <h3 className="mt-2 text-3xl font-medium tracking-tight md:text-4xl">
                LLMOps evaluation <span className="font-serif italic text-accent">report</span>
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-ink-muted">
                Golden-dataset run persisted in Firestore (<code className="font-mono text-xs">evaluation_runs</code>):
                hallucination, precision@K, recall, abstention and cost.
              </p>
            </div>
            {latestEval ? (
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-ink-muted">{latestEval.run_id}</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    latestEval.gate_passed ? "bg-ok text-paper" : "bg-bad text-paper"
                  }`}
                >
                  {latestEval.gate_passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  Gate {latestEval.gate_passed ? "passed" : "failed"}
                </span>
              </div>
            ) : null}
          </div>

          {latestEval ? (
            <>
              <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-5">
                {[
                  {
                    l: "Hallucination rate",
                    v: latestEval.summary.hallucination_rate,
                    fmt: (x: number) => `${(x * 100).toFixed(1)}%`,
                    t: `≤ ${(latestEval.thresholds.max_hallucination_rate * 100).toFixed(0)}%`,
                    bar: latestEval.summary.hallucination_rate / Math.max(latestEval.thresholds.max_hallucination_rate, 1e-9),
                  },
                  {
                    l: "Context precision@K",
                    v: latestEval.summary.context_precision,
                    fmt: (x: number) => `${(x * 100).toFixed(1)}%`,
                    t: `≥ ${(latestEval.thresholds.min_context_precision * 100).toFixed(0)}%`,
                    bar: latestEval.summary.context_precision,
                  },
                  {
                    l: "Context recall@K",
                    v: latestEval.summary.context_recall,
                    fmt: (x: number) => `${(x * 100).toFixed(1)}%`,
                    t: "expected doc coverage",
                    bar: latestEval.summary.context_recall,
                  },
                  {
                    l: "Abstention accuracy",
                    v: latestEval.summary.abstention_accuracy,
                    fmt: (x: number) => `${(x * 100).toFixed(0)}%`,
                    t: `${latestEval.summary.unanswerable_cases} negative probes`,
                    bar: latestEval.summary.abstention_accuracy,
                  },
                  {
                    l: "Avg cost / query",
                    v: latestEval.summary.avg_cost_per_query_usd,
                    fmt: (x: number) => `$${x.toFixed(5)}`,
                    t: `p95 $${latestEval.summary.p95_cost_per_query_usd.toFixed(5)}`,
                    bar: latestEval.summary.avg_cost_per_query_usd / 0.005,
                  },
                ].map((m, i) => (
                  <motion.div
                    key={m.l}
                    initial={reduce ? false : { opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, ease: EASE, delay: i * 0.06 }}
                  >
                    <p className="text-xs text-ink-muted">{m.l}</p>
                    <p className="mt-2 font-serif text-4xl leading-none">{m.fmt(m.v)}</p>
                    <div className="mt-3">
                      <Bar value={m.bar} tone="ink" delay={0.2 + i * 0.06} />
                    </div>
                    <p className="mt-2 font-mono text-[10.5px] text-ink-muted">{m.t}</p>
                  </motion.div>
                ))}
              </div>

              <div className="card mt-10 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      {["Case", "Category", "Query", "Grounding", "Precision", "Cost", "Latency"].map((h) => (
                        <th key={h} className="eyebrow px-4 py-3 !text-[10px] font-normal">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {latestEval.cases.map((c) => (
                      <tr key={c.case_id} className="transition-colors hover:bg-paper/70">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink">{c.case_id}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-muted">{c.category}</span>
                        </td>
                        <td className="max-w-md truncate px-4 py-3 text-ink-soft" title={c.query}>
                          {c.query}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {c.hallucinated ? (
                            <span className="inline-flex items-center gap-1.5 text-bad">
                              <span className="h-1.5 w-1.5 rounded-full bg-bad" /> Hallucinated
                            </span>
                          ) : c.unanswerable ? (
                            <span className="inline-flex items-center gap-1.5 text-warn">
                              <span className="h-1.5 w-1.5 rounded-full bg-warn" /> Abstained OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-ok">
                              <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Grounded
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                          {c.context_precision !== null ? `${(c.context_precision * 100).toFixed(0)}%` : "n/a"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">${c.cost_usd.toFixed(6)}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-muted">{c.latency_ms.toFixed(0)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="card mt-8 p-8 text-center text-sm text-ink-muted">
              No evaluation runs persisted yet. Run the automated LLMOps evaluator to populate this report.
            </div>
          )}
        </section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 font-mono text-[11px] text-ink-muted">
          <span>Built by Daniel Tafur · AI Agent Engineer</span>
          <a href="https://danieltafur.vercel.app" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            danieltafur.vercel.app ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
