<#
.SYNOPSIS
    Deploys GCP infrastructure, builds container images via Cloud Build, seeds corpus to GCS, and executes the Cloud Workflow ingestion job.
    Compatible with Windows PowerShell 5.1+.
#>
[CmdletBinding()]
param(
    [string]$ProjectId = "gen-lang-client-0527325883",
    [string]$Region = "us-central1",
    [string]$RepoName = "hybrid-rag-llmops-gcp",
    [string]$Tag = "",
    [switch]$SkipBuild,
    [switch]$SkipIngest,
    [switch]$PlanOnly,
    [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required CLI '$Name' was not found on PATH."
    }
}

function Ensure-GcpAuth {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $activeAccount = & gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null
    $authExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($authExit -eq 0 -and -not [string]::IsNullOrWhiteSpace(($activeAccount | Out-String))) {
        Write-Host "[OK] Active gcloud account: $($activeAccount.Trim())"
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($env:CLOUDSDK_AUTH_ACCESS_TOKEN)) {
        Write-Host "[OK] Using existing CLOUDSDK_AUTH_ACCESS_TOKEN for non-interactive gcloud calls."
        return
    }

    $adcPath = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
    if (-not (Test-Path $adcPath)) {
        throw "No active gcloud account and no ADC file at $adcPath. Run 'gcloud auth login' and 'gcloud auth application-default login'."
    }

    $adc = Get-Content -Path $adcPath -Raw | ConvertFrom-Json
    $body = @{
        client_id     = $adc.client_id
        client_secret = $adc.client_secret
        refresh_token = $adc.refresh_token
        grant_type    = "refresh_token"
    }
    $tokenResp = Invoke-RestMethod -Method Post -Uri "https://oauth2.googleapis.com/token" -Body $body -UseBasicParsing
    if ([string]::IsNullOrWhiteSpace($tokenResp.access_token)) {
        throw "Failed to refresh GCP access token from ADC."
    }
    $env:CLOUDSDK_AUTH_ACCESS_TOKEN = $tokenResp.access_token
    Write-Host "[OK] Refreshed ADC access token into CLOUDSDK_AUTH_ACCESS_TOKEN."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$tfDir = Join-Path $repoRoot "infra\terraform"
$tfStateDir = Join-Path $env:LOCALAPPDATA "hybrid-rag-llmops-gcp\tfstate"
if (-not (Test-Path $tfStateDir)) {
    New-Item -ItemType Directory -Path $tfStateDir -Force | Out-Null
}
$tfStatePath = Join-Path $tfStateDir "terraform.tfstate"

Assert-CommandExists -Name "gcloud"
Assert-CommandExists -Name "terraform"
Ensure-GcpAuth

Write-Host "[INFO] Configuring gcloud defaults for project '$ProjectId' and region '$Region'..."
& gcloud config set project $ProjectId --quiet | Out-Null
& gcloud config set run/region $Region --quiet | Out-Null

Write-Host "[INFO] Pre-enabling bootstrap APIs..."
& gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$ProjectId --quiet
if ($LASTEXITCODE -ne 0) { throw "Failed to enable bootstrap GCP APIs." }

if ([string]::IsNullOrWhiteSpace($Tag)) {
    $Tag = Get-Date -Format "yyyyMMdd-HHmmss"
}
Write-Host "[INFO] Using image tag: $Tag"

Write-Host "[INFO] Initializing and validating Terraform..."
& terraform -chdir="$tfDir" init
if ($LASTEXITCODE -ne 0) { throw "terraform init failed." }

& terraform -chdir="$tfDir" validate
if ($LASTEXITCODE -ne 0) { throw "terraform validate failed." }

$arHost = "$Region-docker.pkg.dev/$ProjectId/$RepoName"
$ragApiImage = "$arHost/hybrid-rag-api`:$Tag"
$ingestionImage = "$arHost/hybrid-rag-ingestion-job`:$Tag"

if (-not $SkipBuild) {
    Write-Host "[INFO] Applying APIs and Artifact Registry repository via Terraform..."
    & terraform -chdir="$tfDir" apply -auto-approve `
        -state="$tfStatePath" `
        -target="google_project_service.apis" `
        -target="google_artifact_registry_repository.containers" `
        -var="project_id=$ProjectId" `
        -var="region=$Region" `
        -var="artifact_registry_repo=$RepoName"
    if ($LASTEXITCODE -ne 0) { throw "Targeted Terraform apply for APIs and Artifact Registry failed." }

    $serviceSpecs = @(
        @{ Dir = (Join-Path $repoRoot "services\ingestion_job"); Image = $ingestionImage },
        @{ Dir = (Join-Path $repoRoot "services\rag_api"); Image = $ragApiImage }
    )

    foreach ($svc in $serviceSpecs) {
        Write-Host "[INFO] Building $($svc.Image) via Cloud Build..."
        & gcloud builds submit $svc.Dir --tag $svc.Image --project=$ProjectId --region=$Region --quiet
        if ($LASTEXITCODE -ne 0) {
            throw "gcloud builds submit failed for $($svc.Dir)."
        }
    }
}

$tfVars = @(
    "-state=$tfStatePath",
    "-var=project_id=$ProjectId",
    "-var=region=$Region",
    "-var=artifact_registry_repo=$RepoName",
    "-var=rag_api_image=$ragApiImage",
    "-var=ingestion_job_image=$ingestionImage"
)

if ($PlanOnly) {
    & terraform -chdir="$tfDir" plan @tfVars
    if ($LASTEXITCODE -ne 0) { throw "terraform plan failed." }
    exit 0
}

Write-Host "[INFO] Applying full Terraform stack..."
if ($AutoApprove) {
    & terraform -chdir="$tfDir" apply -auto-approve @tfVars
} else {
    & terraform -chdir="$tfDir" apply @tfVars
}
if ($LASTEXITCODE -ne 0) { throw "terraform apply failed." }

$outputsJson = & terraform -chdir="$tfDir" output -state="$tfStatePath" -json
$outputs = $outputsJson | ConvertFrom-Json
$bucketName = $outputs.corpus_bucket_name.value
$workflowName = $outputs.workflow_name.value

if (-not $SkipIngest) {
    Write-Host "[INFO] Uploading synthetic technical corpus to gs://$bucketName/corpus/..."
    $corpusDir = Join-Path $repoRoot "data\corpus"
    & gcloud storage cp "$corpusDir\*.md" "gs://$bucketName/corpus/" --project=$ProjectId --quiet
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload corpus documents to GCS." }

    Write-Host "[INFO] Executing Cloud Workflow '$workflowName' to populate Firestore Vector Search..."
    & gcloud workflows run $workflowName --location=$Region --project=$ProjectId --data='{\"trigger_source\":\"deploy-gcp\"}' --quiet
    if ($LASTEXITCODE -ne 0) { throw "Cloud Workflow execution failed." }
}

Write-Host "[INFO] Terraform Outputs:"
Write-Output $outputsJson
