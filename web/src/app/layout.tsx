import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enterprise Hybrid RAG & LLMOps Console | GCP Firestore Vector Search",
  description:
    "Serverless Hybrid RAG (Firestore Vector Search + Okapi BM25 + RRF) with Vertex AI Gemini 3.8 Flash, Cloud Logging FinOps Telemetry, and Automated Pre-Deployment LLMOps Quality Gate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#070b14] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-100">
        {children}
      </body>
    </html>
  );
}
