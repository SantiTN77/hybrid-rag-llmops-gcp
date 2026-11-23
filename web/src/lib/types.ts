export interface RetrievedChunk {
  chunk_id: string;
  doc_id: string;
  title: string;
  section: string;
  chunk_index: number;
  content: string;
  vector_score: number | null;
  vector_rank: number | null;
  bm25_score: number;
  bm25_rank: number | null;
  rrf_score: number;
}

export interface CostBreakdown {
  prompt_tokens: number;
  completion_tokens: number;
  embedding_tokens: number;
  total_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  embedding_cost_usd: number;
  estimated_cost_usd: number;
}

export interface LatencyBreakdown {
  embedding_ms: number;
  vector_search_ms: number;
  lexical_search_ms: number;
  generation_ms: number;
  total_ms: number;
}

export interface QueryResponse {
  trace_id: string;
  query: string;
  answer: string;
  abstained: boolean;
  cited_chunk_ids: string[];
  retrieval_config: {
    top_k: number;
    vector_weight: number;
    lexical_weight: number;
    rrf_k: number;
  };
  chunks: RetrievedChunk[];
  telemetry: {
    model: string;
    embedding_model: string;
    cost: CostBreakdown;
    latency_ms: LatencyBreakdown;
    cloud_logging_event: string;
  };
}

export interface CorpusDocument {
  doc_id: string;
  title: string;
  source_uri: string;
  chunk_count: number;
  total_words: number;
  ingested_at: string;
}

export interface CorpusResponse {
  database: string;
  collection: string;
  embedding_model: string;
  embedding_dimension: number;
  document_count: number;
  total_chunks: number;
  total_words: number;
  documents: CorpusDocument[];
}

export interface EvalCase {
  case_id: string;
  category: string;
  query: string;
  unanswerable: boolean;
  abstained: boolean;
  hallucinated: boolean;
  hallucination_reason: string;
  context_precision: number | null;
  context_recall: number | null;
  fact_coverage: number | null;
  cited_chunk_ids: string[];
  retrieved_doc_ids: string[];
  expected_doc_ids: string[];
  cost_usd: number;
  latency_ms: number;
  answer_preview: string;
}

export interface EvalRun {
  run_id: string;
  timestamp: string;
  dataset_version: string;
  model: string;
  embedding_model: string;
  gate_passed: boolean;
  thresholds: {
    max_hallucination_rate: number;
    min_context_precision: number;
    max_avg_cost_per_query_usd: number;
  };
  summary: {
    total_cases: number;
    answerable_cases: number;
    unanswerable_cases: number;
    hallucinations_count: number;
    hallucination_rate: number;
    context_precision: number;
    context_recall: number;
    fact_coverage: number;
    abstention_accuracy: number;
    avg_cost_per_query_usd: number;
    p95_cost_per_query_usd: number;
    total_eval_cost_usd: number;
    avg_latency_ms: number;
    p95_latency_ms: number;
  };
  cases: EvalCase[];
}

export interface EvaluationsResponse {
  count: number;
  latest: EvalRun | null;
  runs: EvalRun[];
}

export interface HealthResponse {
  status: string;
  service: string;
  model: string;
  embedding_model: string;
  firestore_database: string;
  zero_idle_cost_policy: boolean;
  timestamp: string;
}
