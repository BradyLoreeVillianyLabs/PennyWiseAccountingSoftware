[CmdletBinding()]
param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$shareComposePath = Join-Path $runtimeDirectory "compose.share.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$shareStatePath = Join-Path $runtimeDirectory ".share-state.json"
$stoppedTunnel = $false

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

if (Test-Path -LiteralPath $shareStatePath -PathType Leaf) {
  $state = Get-Content -LiteralPath $shareStatePath -Raw | ConvertFrom-Json
  $processId = [int]$state.processId
  $localPort = [int]$state.localPort
  $subdomain = [string]$state.subdomain
  $expectedExecutable = [string]$state.executablePath
  if ($state.schema -ne "clearledger-share-state-v1" -or
      $processId -lt 1 -or
      $localPort -lt 1024 -or
      $localPort -gt 65535 -or
      $subdomain -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' -or
      [string]::IsNullOrWhiteSpace($expectedExecutable)) {
    throw "The packaged share state is invalid. No Loclx process was stopped."
  }

  $ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
  if ($ownedProcess) {
    $actualExecutable = [IO.Path]::GetFullPath([string]$ownedProcess.ExecutablePath)
    $expectedExecutable = [IO.Path]::GetFullPath($expectedExecutable)
    $commandLine = [string]$ownedProcess.CommandLine
    $targetMarker = "127.0.0.1:$localPort"
    $domainMarker = if ([bool]$state.reserved) { "$subdomain.loclx.io" } else { $subdomain }
    if (-not $actualExecutable.Equals($expectedExecutable, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($actualExecutable) -notmatch '^loclx(?:\.exe)?$' -or
        -not $commandLine.Contains("tunnel") -or
        -not $commandLine.Contains("http") -or
        -not $commandLine.Contains($targetMarker) -or
        -not $commandLine.Contains($domainMarker)) {
      throw "The recorded process no longer matches the packaged ClearLedger tunnel. It was not stopped."
    }
    Stop-Process -Id $processId -Force -ErrorAction Stop
    try { Wait-Process -Id $processId -Timeout 10 -ErrorAction Stop } catch {
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        throw "The packaged ClearLedger Loclx tunnel did not stop."
      }
    }
    $stoppedTunnel = $true
  }
  Remove-Item -LiteralPath $shareStatePath -Force
}

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $shareComposePath -PathType Leaf)) {
  if (-not $Quiet) {
    if ($stoppedTunnel) { Write-Host "The packaged ClearLedger Loclx tunnel is stopped." }
    else { Write-Host "No packaged ClearLedger share is configured in this folder." }
  }
  return
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to stop the packaged ClearLedger share services."
}
$composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath
$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath,
  "--file", $shareComposePath
)

$placeholderVariables = @{
  CLEARLEDGER_SHARE_EMAIL = "stopped-share@example.invalid"
  CLEARLEDGER_SHARE_NAME = "Stopped share"
  CLEARLEDGER_SHARE_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000000"
  CLEARLEDGER_SHARE_SUBDOMAIN = "stopped-share"
  CLEARLEDGER_SHARE_PORT = "3100"
}
$previousVariables = @{}
try {
  foreach ($entry in $placeholderVariables.GetEnumerator()) {
    $previousVariables[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }
  Set-Location -LiteralPath $runtimeDirectory
  Invoke-ClearLedgerCompose @composeArguments rm --force --stop share_web share_api *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker could not stop the packaged ClearLedger share." }
} finally {
  foreach ($entry in $previousVariables.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
}
if (-not $Quiet) {
  Write-Host "The packaged ClearLedger share services and its recorded Loclx tunnel are stopped."
}
