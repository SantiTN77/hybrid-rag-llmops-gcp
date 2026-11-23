<#
.SYNOPSIS
    Runs live E2E verification against Private Cloud Run (unauth 403 + OIDC 200) and Vercel OIDC BFF.
    Compatible with Windows PowerShell 5.1+.
#>
[CmdletBinding()]
param(
    [string]$RagApiUrl = "https://hybrid-rag-api-epheuj6evq-uc.a.run.app",
    [string]$VercelUrl = "https://hybrid-rag-llmops-gcp-web.vercel.app",
    [string]$SaKeyPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SaKeyPath)) {
    $SaKeyPath = Join-Path $env:LOCALAPPDATA "hybrid-rag-llmops-gcp\keys\rag-vercel-bff-invoker-key.json"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $env:LIVE_RAG_API_URL = $RagApiUrl
    $env:LIVE_VERCEL_URL = $VercelUrl
    $env:GCP_SA_KEY_PATH = $SaKeyPath

    & uv run --with pytest --with httpx --with requests --with google-auth --with google-genai --with google-cloud-firestore --with pydantic pytest tests/unit tests/e2e -v
    if ($LASTEXITCODE -ne 0) {
        throw "Live verification suite failed."
    }
} finally {
    Pop-Location
}
