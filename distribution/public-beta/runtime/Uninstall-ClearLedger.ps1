[CmdletBinding()]
param(
  [switch]$DeleteData,
  [switch]$RemoveRuntimeImage,
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$backupScript = Join-Path $runtimeDirectory "Backup-ClearLedger.ps1"
$stopShareScript = Join-Path $runtimeDirectory "Stop-ClearLedgerShare.ps1"
$manifestPath = Join-Path $runtimeDirectory "release-manifest.json"

function Get-ClearLedgerComposeProjectName([string]$Path) {
  $projectLines = @(
    Get-Content -LiteralPath $Path |
      Where-Object { $_.TrimStart([char]0xFEFF) -match '^CLEARLEDGER_COMPOSE_PROJECT_NAME=(.*)$' }
  )
  if ($projectLines.Count -gt 1) {
    throw "beta.env contains duplicate CLEARLEDGER_COMPOSE_PROJECT_NAME entries."
  }
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

$imageName = ""
if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
  $imageLine = Get-Content -LiteralPath $environmentPath |
    Where-Object { $_ -match '^CLEARLEDGER_IMAGE=(.+)$' } |
    Select-Object -First 1
  if ($imageLine) { $imageName = [regex]::Match($imageLine, '^CLEARLEDGER_IMAGE=(.+)$').Groups[1].Value }
}
if (-not $imageName -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  $imageName = [string](Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).image
}
if ($imageName -and $imageName -notmatch '^clearledger/public-beta:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "The configured ClearLedger runtime image name is invalid."
}

Set-Location -LiteralPath $runtimeDirectory
if ($DeleteData) {
  Write-Warning "This permanently removes the ClearLedger database and stored documents from Docker."
  $answer = Read-Host "Type DELETE ALL DATA to continue"
  if ($answer -cne "DELETE ALL DATA") { throw "Uninstall cancelled without removing data." }
  if (-not $SkipBackup -and (Test-Path -LiteralPath $environmentPath)) {
    & $backupScript
  }
}

if (Test-Path -LiteralPath $environmentPath) {
  if (Test-Path -LiteralPath $stopShareScript -PathType Leaf) { & $stopShareScript -Quiet }
  $composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath
  $arguments = @(
    "compose",
    "--project-name", $composeProjectName,
    "--env-file", $environmentPath,
    "--file", $composePath,
    "down"
  )
  if ($DeleteData) { $arguments += "--volumes" }
  Invoke-ClearLedgerCompose @arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker could not remove the ClearLedger services cleanly." }
}

if ($RemoveRuntimeImage) {
  if (-not $imageName) { throw "The ClearLedger runtime image could not be identified safely." }
  docker image rm $imageName
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "The ClearLedger runtime image is still used by another container and was preserved."
  }
}

if ($DeleteData) {
  Write-Host "ClearLedger services, database, and document volumes were removed."
  Write-Host "The program folder and any Backups folder were preserved and can be deleted manually."
} else {
  Write-Host "ClearLedger services were removed, but the database and documents were preserved."
  Write-Host "Run Start-ClearLedger.ps1 to reinstall against the preserved data."
}
