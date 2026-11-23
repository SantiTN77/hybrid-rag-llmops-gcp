<#
.SYNOPSIS
    Scans tracked filenames, working tree files, and git history for leaked secrets or forbidden credential files.
    Compatible with Windows PowerShell 5.1+.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$RepoRoot = (Resolve-Path $RepoRoot).Path

$findings = New-Object System.Collections.Generic.List[string]

# Build regex patterns dynamically to avoid self-matching
$secretPatterns = @(
    @{ Name = "PEM Private Key"; Regex = ('-----BEGIN ' + '([A-Z ]+)?PRIVATE KEY-----(?:\\n|\r?\n)[A-Za-z0-9+/=]{24,}') },
    @{ Name = "GCP SA JSON type+key"; Regex = ('"type"\s*:\s*"' + 'service_account"[\s\S]{0,400}"private_key"\s*:\s*"-----BEGIN') },
    @{ Name = "GCP SA JSON private_key"; Regex = ('"private_key"\s*:\s*"' + '-----BEGIN ([A-Z ]+)?PRIVATE KEY-----(?:\\n|\r?\n)[A-Za-z0-9+/=]{24,}') },
    @{ Name = "Google API Key"; Regex = ('AIza' + '[0-9A-Za-z\-_]{35}') },
    @{ Name = "GitHub Token"; Regex = ('(ghp_|gho_|ghu_|ghs_|github_pat_)' + '[A-Za-z0-9_]{16,}') },
    @{ Name = "Vercel Token"; Regex = ('(vcp_[A-Za-z0-9]{20,}|vercel_[A-Za-z0-9\-]{20,})') },
    @{ Name = "OAuth Refresh Token"; Regex = ('"refresh_token"\s*:\s*"' + '[A-Za-z0-9_\-/\.]{16,}"') },
    @{ Name = "Browser-Exposed Secret Env"; Regex = ('(?:process\.env\.|^\s*)NEXT_PUBLIC_[A-Z0-9_]*' + '(KEY|SECRET|TOKEN|PRIVATE|CREDENTIAL)(?:\s*=|\b)') }
)

$forbiddenFilenamePatterns = @(
    '(^|/)\.env($|\.)',
    '\.tfstate($|\.)',
    '\.tfvars($|\.)',
    '(sa-key|service[-_]?account).*\.json$',
    '\.(pem|p12|pfx|key)$',
    '(^|/)package-lock\.json$'
)
$allowedExceptions = @(
    '(^|/)\.env\.example$',
    '(^|/)terraform\.tfvars\.example$',
    '\.tfvars\.example$'
)

function Test-ForbiddenFileName {
    param([string]$RelPath)
    $norm = $RelPath -replace '\\', '/'
    foreach ($ex in $allowedExceptions) {
        if ($norm -match $ex) { return $false }
    }
    foreach ($pat in $forbiddenFilenamePatterns) {
        if ($norm -match $pat) { return $true }
    }
    return $false
}

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
$hasGit = ($null -ne $gitCmd) -and (Test-Path (Join-Path $RepoRoot ".git"))

$trackedCount = 0
if ($hasGit) {
    $trackedFiles = & git -C $RepoRoot ls-files
    foreach ($tf in $trackedFiles) {
        if ([string]::IsNullOrWhiteSpace($tf)) { continue }
        $trackedCount++
        if (Test-ForbiddenFileName -RelPath $tf) {
            $findings.Add("Tracked forbidden file: $tf")
        }
    }
}

$skipDirs = @('.git', '.terraform', '.venv', 'venv', 'node_modules', '.next', 'dist', 'build', '__pycache__', '.pytest_cache', '.ruff_cache', '.mypy_cache')
$binaryExts = @('.exe', '.dll', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.pyc')
$selfPath = (Resolve-Path $PSCommandPath).Path
$scannedFiles = 0

Get-ChildItem -Path $RepoRoot -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $full = $_.FullName
    if ($full -eq $selfPath) { return }
    $rel = $full.Substring($RepoRoot.Length).TrimStart('\', '/')
    $segments = $rel -split '[\\/]'
    foreach ($seg in $segments) {
        if ($skipDirs -contains $seg) { return }
    }
    if ($binaryExts -contains $_.Extension.ToLowerInvariant()) { return }
    if ($_.Length -gt 2097152) { return }

    $scannedFiles++
    $content = Get-Content -Path $full -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrEmpty($content)) { return }

    foreach ($p in $secretPatterns) {
        if ($content -match $p.Regex) {
            $findings.Add("Working tree match [$($p.Name)] in $rel")
        }
    }
}

$historyChecked = $false
if ($hasGit) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $null = & cmd /c "git -C `"$RepoRoot`" rev-parse --verify HEAD >nul 2>&1"
    $headExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($headExit -eq 0) {
        $historyChecked = $true
        $inScanScript = $false
        $diffLines = & git -C $RepoRoot log -p --all --no-color
        foreach ($line in $diffLines) {
            if ($line -match '^diff --git a/(.+?) b/(.+)$') {
                $inScanScript = ($Matches[2] -eq 'scripts/secret-scan.ps1')
                continue
            }
            if ($inScanScript) { continue }
            if ($line -match '^[+-]' -and $line -notmatch '^(\+\+\+|---)') {
                foreach ($p in $secretPatterns) {
                    if ($line -match $p.Regex) {
                        $findings.Add("Git history match [$($p.Name)]")
                    }
                }
            }
        }
    }
}

Write-Host "[SECRET-SCAN] RepoRoot=$RepoRoot | TrackedFiles=$trackedCount | WorkingTreeFiles=$scannedFiles | GitHistoryChecked=$historyChecked | Findings=$($findings.Count)"
if ($findings.Count -gt 0) {
    foreach ($f in $findings) {
        Write-Host "[FINDING] $f"
    }
    exit 1
}

Write-Host "[OK] Secret scan passed with 0 findings."
exit 0
