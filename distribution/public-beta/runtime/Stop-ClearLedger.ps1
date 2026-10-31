[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$stopShareScript = Join-Path $runtimeDirectory "Stop-ClearLedgerShare.ps1"

function Get-ClearLedgerComposeProjectName([string]$Path) {
  $projectLines = @(
    Get-Content -LiteralPath $Path |
      Where-Object { $_.TrimStart([char]0xFEFF) -match '^CLEARLEDGER_COMPOSE_PROJECT_NAME=(.*)$' }
  )
  if ($projectLines.Count -gt 1) { throw "beta.env contains duplicate CLEARLEDGER_COMPOSE_PROJECT_NAME entries." }
  $projectName = if ($projectLines.Count -eq 1) {
    [regex]::Match(
      $projectLines[0].TrimStart([char]0xFEFF),
      '^CLEARLEDGER_COMPOSE_PROJECT_NAME=(.*)$'
    ).Groups[1].Value
  } else {
    "clearledger-beta"
  }
  if ($projectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
    throw "beta.env contains an invalid CLEARLEDGER_COMPOSE_PROJECT_NAME."
  }
  return $projectName
}

if (-not (Test-Path -LiteralPath $environmentPath)) {
  Write-Host "ClearLedger has not been initialized in this folder."
  exit 0
}

Set-Location -LiteralPath $runtimeDirectory
if (Test-Path -LiteralPath $stopShareScript -PathType Leaf) { & $stopShareScript -Quiet }
$composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath
$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath
)
Invoke-ClearLedgerCompose @composeArguments down
if ($LASTEXITCODE -ne 0) { throw "Docker could not stop ClearLedger cleanly." }
Write-Host "ClearLedger is stopped. Its database and documents were preserved."
