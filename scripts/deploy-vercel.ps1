<#
.SYNOPSIS
    Deploys the isolated web/ Next.js App Router UI and OIDC BFF to Vercel production using pnpm.
    Compatible with Windows PowerShell 5.1+.
#>
[CmdletBinding()]
param(
    [string]$ProjectName = "hybrid-rag-llmops-gcp-web",
    [string]$RagApiUrl = "",
    [string]$SaKeyPath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "web"
$parentVercel = Join-Path (Split-Path -Parent $repoRoot) ".vercel"

if (Test-Path $parentVercel) {
    Write-Warning "Parent workspace .vercel directory exists at $parentVercel; running strictly inside $webDir."
}

Push-Location $webDir
try {
    & vercel link --project $ProjectName --yes
    if ($LASTEXITCODE -ne 0) {
        throw "vercel link failed."
    }

    if (-not [string]::IsNullOrWhiteSpace($RagApiUrl)) {
        Write-Host "[INFO] Setting CLOUD_RUN_RAG_API_URL on Vercel production..."
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & vercel env rm CLOUD_RUN_RAG_API_URL production --yes 2>$null | Out-Null
        $ErrorActionPreference = $prevEap
        $RagApiUrl.Trim().TrimEnd('/') | & vercel env add CLOUD_RUN_RAG_API_URL production
    }

    if (-not [string]::IsNullOrWhiteSpace($SaKeyPath) -and (Test-Path $SaKeyPath)) {
        Write-Host "[INFO] Setting GCP_SA_KEY_JSON on Vercel production..."
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & vercel env rm GCP_SA_KEY_JSON production --yes 2>$null | Out-Null
        $ErrorActionPreference = $prevEap
        $keyContent = (Get-Content -Path $SaKeyPath -Raw).Trim()
        $keyContent | & vercel env add GCP_SA_KEY_JSON production
    }

    Write-Host "[INFO] Deploying web/ to Vercel production..."
    & vercel deploy --prod --yes
    if ($LASTEXITCODE -ne 0) {
        throw "vercel deploy --prod failed."
    }
} finally {
    Pop-Location
}
