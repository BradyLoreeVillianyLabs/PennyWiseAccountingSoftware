[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$prerequisiteScriptPath = Join-Path $runtimeDirectory "Test-ClearLedgerPrerequisites.ps1"

if (Test-Path -LiteralPath $prerequisiteScriptPath -PathType Leaf) {
  & $prerequisiteScriptPath -Json
  Write-Host ""
}

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
  throw "ClearLedger has not been initialized. Run Start-ClearLedger.ps1 first."
}

Set-Location -LiteralPath $runtimeDirectory
$composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath
$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath
)
$localPort = 3000
$localPortLines = @(
  Get-Content -LiteralPath $environmentPath |
    Where-Object { $_ -match '^CLEARLEDGER_LOCAL_PORT=(.+)$' }
)
if ($localPortLines.Count -eq 1) {
  $candidatePort = 0
  $candidateValue = [regex]::Match($localPortLines[0], '^CLEARLEDGER_LOCAL_PORT=(.+)$').Groups[1].Value
  if ([int]::TryParse($candidateValue, [ref]$candidatePort) -and
      $candidatePort -ge 1024 -and
      $candidatePort -le 65535) {
    $localPort = $candidatePort
  }
}
Write-Host "Local address: http://localhost:$localPort"
Write-Host "Service status"
Invoke-ClearLedgerCompose @composeArguments ps
Write-Host "Recent service logs (credentials are not printed)"
Invoke-ClearLedgerCompose @composeArguments logs --tail 150 postgres migrate api web
