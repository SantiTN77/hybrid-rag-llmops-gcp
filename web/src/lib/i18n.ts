"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Lang = "en" | "es";

const KEY = "rag-console-lang";
const listeners = new Set<() => void>();

function read(): Lang {
  if (typeof window === "undefined") return "en";
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "es" || q === "en") return q;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "es" || v === "en") return v;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "en" as Lang,
  );
  const set = useCallback((l: Lang) => {
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    url.searchParams.set("lang", l);
    window.history.replaceState(null, "", url);
    document.documentElement.lang = l;
    listeners.forEach((f) => f());
  }, []);
  return [lang, set];
}

export const STRINGS = {
  en: {
    title: "Hybrid RAG",
    titleRest: "LLMOps Console",
    connected: "Private Cloud Run · OIDC",
    connecting: "Connecting…",
    source: "Source",
    eyebrow: "Firestore Vector Search · Okapi BM25 · Reciprocal Rank Fusion",
    h1a: "Answers grounded in your corpus —",
    h1b: "or none at all.",
    lede: "Every answer cites the exact chunks it used. Every release must pass a golden-dataset gate on hallucination, precision and cost before it ships.",
    kCorpus: "Indexed corpus",
    kCorpusLoading: "Loading index…",
    kGate: "LLMOps quality gate",
    kGateCases: "golden cases",
    kNoRuns: "No runs yet",
    kHall: "Hallucination rate · gate ≤ 10%",
    kAwait: "Awaiting telemetry",
    kCost: "Avg cost / query · gate ≤ $0.005",
    kAvgLat: "Avg latency",
    kFinops: "FinOps logging on",
    docs: "Docs",
    chunks: "chunks",
    ask: "Ask the corpus",
    samples: "Golden & adversarial samples",
    placeholder: "Ask an architecture, IAM, FinOps or SLA question…",
    hybrid: "Hybrid RRF 0.6 / 0.4",
    vector: "Vector only",
    lexical: "BM25 only",
    run: "Run Hybrid RAG",
    running: "Retrieving…",
    pipeline: ["Embed query", "Firestore vector search", "BM25 lexical", "RRF fusion", "Gemini synthesis"],
    synth: "Grounded Synthesis",
    abstained: "Hallucination guard · abstained",
    citation: "citation verified",
    citations: "citations verified",
    retrieved: "Retrieved chunks · RRF fusion",
    telemetry: "Live Query FinOps & Latency",
    tokensIn: "in",
    tokensOut: "out",
    tokensEmbed: "embed tokens",
    latency: "Latency",
    lat: ["Vertex AI embedding", "Firestore vector search", "Okapi BM25 lexical", "Gemini synthesis"],
    teleEmpty:
      "Run a query to see per-query token usage, exact USD cost, the latency split between embedding, vector search, BM25 and generation, and the Cloud Logging trace.",
    posture: "Zero idle cost · private IAM",
    postureItems: [
      ["Firestore Vector Search", "768d flat COSINE index — no always-on vector endpoint, $0 idle."],
      ["Private Cloud Run v2", "min 0 / max 2 instances; unauthenticated calls get HTTP 403."],
      ["Server-side OIDC BFF", "Short-lived Google ID tokens minted per request by a scoped SA."],
      ["Workflows + Cloud Run Job", "Async GCS ingestion with PII redaction before embedding."],
    ],
    corpus: "Indexed corpus",
    documents: "documents",
    gateEyebrow: "Pre-deployment quality gate",
    gateTitleA: "LLMOps evaluation",
    gateTitleB: "report",
    gateLede: "Golden-dataset run persisted in Firestore (evaluation_runs): hallucination, precision@K, recall, abstention and cost.",
    gatePassed: "Gate passed",
    gateFailed: "Gate failed",
    mHall: "Hallucination rate",
    mPrec: "Context precision@K",
    mRec: "Context recall@K",
    mRecSub: "expected doc coverage",
    mAbs: "Abstention accuracy",
    mAbsSub: "negative probes",
    mCost: "Avg cost / query",
    cols: ["Case", "Category", "Query", "Grounding", "Precision", "Cost", "Latency"],
    grounded: "Grounded",
    hallucinated: "Hallucinated",
    abstainedOk: "Abstained OK",
    noRuns: "No evaluation runs persisted yet. Run the automated LLMOps evaluator to populate this report.",
    built: "Built by Daniel Tafur · AI Agent Engineer",
    failed: "Query execution failed.",
  },
  es: {
    title: "RAG híbrido",
    titleRest: "consola LLMOps",
    connected: "Cloud Run privado · OIDC",
    connecting: "Conectando…",
    source: "Código",
    eyebrow: "Firestore Vector Search · Okapi BM25 · Reciprocal Rank Fusion",
    h1a: "Respuestas fundamentadas en tu corpus —",
    h1b: "o ninguna.",
    lede: "Cada respuesta cita los fragmentos exactos que usó. Cada release debe pasar un quality gate con golden dataset sobre alucinación, precisión y costo antes de desplegarse.",
    kCorpus: "Corpus indexado",
    kCorpusLoading: "Cargando índice…",
    kGate: "Quality gate LLMOps",
    kGateCases: "casos golden",
    kNoRuns: "Sin ejecuciones",
    kHall: "Tasa de alucinación · gate ≤ 10%",
    kAwait: "Esperando telemetría",
    kCost: "Costo prom. / consulta · gate ≤ $0.005",
    kAvgLat: "Latencia prom.",
    kFinops: "Logging FinOps activo",
    docs: "Docs",
    chunks: "fragmentos",
    ask: "Pregúntale al corpus",
    samples: "Ejemplos golden y adversarios",
    placeholder: "Pregunta sobre arquitectura, IAM, FinOps o SLAs…",
    hybrid: "RRF híbrido 0.6 / 0.4",
    vector: "Solo vectorial",
    lexical: "Solo BM25",
    run: "Ejecutar RAG híbrido",
    running: "Recuperando…",
    pipeline: ["Embedding de la consulta", "Búsqueda vectorial Firestore", "Léxica BM25", "Fusión RRF", "Síntesis con Gemini"],
    synth: "Síntesis fundamentada",
    abstained: "Guardia anti-alucinación · se abstuvo",
    citation: "cita verificada",
    citations: "citas verificadas",
    retrieved: "Fragmentos recuperados · fusión RRF",
    telemetry: "FinOps y latencia en vivo",
    tokensIn: "entrada",
    tokensOut: "salida",
    tokensEmbed: "tokens de embedding",
    latency: "Latencia",
    lat: ["Embedding Vertex AI", "Búsqueda vectorial Firestore", "Léxica Okapi BM25", "Síntesis con Gemini"],
    teleEmpty:
      "Ejecuta una consulta para ver el uso de tokens, el costo exacto en USD, la latencia de embedding, búsqueda vectorial, BM25 y generación, y la traza de Cloud Logging.",
    posture: "Costo cero en reposo · IAM privado",
    postureItems: [
      ["Firestore Vector Search", "Índice COSINE de 768d — sin endpoint vectorial siempre encendido, $0 en reposo."],
      ["Cloud Run v2 privado", "Mín. 0 / máx. 2 instancias; las llamadas sin autenticar reciben HTTP 403."],
      ["BFF con OIDC en servidor", "Tokens de identidad de Google de corta duración por petición, con una SA acotada."],
      ["Workflows + Cloud Run Job", "Ingesta asíncrona desde GCS con redacción de PII antes del embedding."],
    ],
    corpus: "Corpus indexado",
    documents: "documentos",
    gateEyebrow: "Quality gate previo al despliegue",
    gateTitleA: "Reporte de evaluación",
    gateTitleB: "LLMOps",
    gateLede: "Ejecución con golden dataset persistida en Firestore (evaluation_runs): alucinación, precisión@K, recall, abstención y costo.",
    gatePassed: "Gate aprobado",
    gateFailed: "Gate fallido",
    mHall: "Tasa de alucinación",
    mPrec: "Precisión de contexto@K",
    mRec: "Recall de contexto@K",
    mRecSub: "cobertura de documentos esperados",
    mAbs: "Precisión de abstención",
    mAbsSub: "pruebas negativas",
    mCost: "Costo prom. / consulta",
    cols: ["Caso", "Categoría", "Consulta", "Fundamentación", "Precisión", "Costo", "Latencia"],
    grounded: "Fundamentada",
    hallucinated: "Alucinó",
    abstainedOk: "Abstención correcta",
    noRuns: "Aún no hay evaluaciones persistidas. Ejecuta el evaluador LLMOps para poblar este reporte.",
    built: "Hecho por Daniel Tafur · AI Agent Engineer",
    failed: "Falló la ejecución de la consulta.",
  },
} as const;

export const SAMPLES = {
  en: [
    {
      label: "Private IAM & BFF Auth",
      tag: "Factual",
      query:
        "What HTTP status codes must a private Cloud Run endpoint return for unauthenticated direct requests, and which Service Account is allowed to invoke it?",
    },
    { label: "SEV-1 Incident SLAs", tag: "Numeric SLA", query: "What are the MTTA, MTTM, and executive update intervals for a SEV-1 critical outage?" },
    {
      label: "Firestore Vector vs Vertex + RRF",
      tag: "Multi-Hop",
      query:
        "Why did Meridian choose Firestore Vector Search over Vertex AI Vector Search Endpoints, what RRF weights are used, and what are the three LLMOps quality gate thresholds?",
    },
    {
      label: "AWS EKS Budget (Out-of-Scope)",
      tag: "Hallucination Test",
      query: "What is Meridian's approved AWS EKS cluster auto-scaling budget and Amazon Bedrock Claude 3.7 pricing rate card?",
    },
  ],
  es: [
    {
      label: "IAM privado y auth del BFF",
      tag: "Factual",
      query:
        "¿Qué códigos de estado HTTP debe devolver un endpoint privado de Cloud Run ante peticiones directas sin autenticar, y qué Service Account puede invocarlo? Responde en español.",
    },
    {
      label: "SLAs de incidentes SEV-1",
      tag: "SLA numérico",
      query: "¿Cuáles son el MTTA, el MTTM y los intervalos de actualización ejecutiva para una caída crítica SEV-1? Responde en español.",
    },
    {
      label: "Firestore Vector vs Vertex + RRF",
      tag: "Multi-salto",
      query:
        "¿Por qué Meridian eligió Firestore Vector Search en lugar de los endpoints de Vertex AI Vector Search, qué pesos RRF usa y cuáles son los tres umbrales del quality gate de LLMOps? Responde en español.",
    },
    {
      label: "Presupuesto AWS EKS (fuera de alcance)",
      tag: "Prueba de alucinación",
      query:
        "¿Cuál es el presupuesto aprobado de Meridian para el autoescalado de clústeres AWS EKS y la tarifa de Amazon Bedrock Claude 3.7? Responde en español.",
    },
  ],
} as const;
