import { GoogleAuth } from "google-auth-library";

/**
 * Server-side only OIDC client for invoking the Private Cloud Run v2 Hybrid RAG API.
 * Mints short-lived Google OIDC ID tokens using scoped Service Account credentials
 * stored strictly in server environment variables (never exposed to browsers).
 */

function parseServiceAccountCredentials(): Record<string, unknown> {
  const rawJson = process.env.GCP_SA_KEY_JSON?.trim();
  if (rawJson) {
    return JSON.parse(rawJson) as Record<string, unknown>;
  }
  const b64 = process.env.GCP_SA_KEY_B64?.trim();
  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  }
  throw new Error("Server misconfiguration: GCP_SA_KEY_JSON is not set.");
}

function getRagApiBaseUrl(): string {
  const url = process.env.CLOUD_RUN_RAG_API_URL?.trim();
  if (!url) {
    throw new Error("Server misconfiguration: CLOUD_RUN_RAG_API_URL is not set.");
  }
  return url.replace(/\/+$/, "");
}

export async function invokePrivateRagApi<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    traceId?: string;
  } = {}
): Promise<T> {
  const baseUrl = getRagApiBaseUrl();
  const credentials = parseServiceAccountCredentials();
  const auth = new GoogleAuth({ credentials });
  const client = await auth.getIdTokenClient(baseUrl);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.traceId) {
    headers["X-Trace-Id"] = options.traceId;
  }

  const response = await client.request<T>({
    url: `${baseUrl}${path}`,
    method: options.method ?? "GET",
    headers,
    data: options.body,
    timeout: 55_000,
  });

  return response.data;
}
