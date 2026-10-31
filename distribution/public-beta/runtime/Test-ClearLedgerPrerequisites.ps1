[CmdletBinding()]
param(
  [ValidateRange(1, 1024)]
  [int]$MinimumFreeSpaceGB = 10,
  [switch]$Json
)

$ErrorActionPreference = "Continue"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$checks = New-Object 'System.Collections.Generic.List[object]'

function Add-ClearLedgerPrerequisiteCheck {
  param(
    [string]$Name,
    [bool]$Ready,
    [string]$Detail,
    [bool]$Required = $true
  )
  $checks.Add([pscustomobject]@{
      name = $Name
      ready = $Ready
      required = $Required
      detail = $Detail
    })
}

Add-ClearLedgerPrerequisiteCheck `
  "windows-64-bit" `
  ($env:OS -eq "Windows_NT" -and [Environment]::Is64BitOperatingSystem) `
  "A supported 64-bit Windows host is required."

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
Add-ClearLedgerPrerequisiteCheck `
  "docker-cli" `
  ($null -ne $dockerCommand) `
  "Docker CLI is required; install Docker Desktop or a supported Docker Engine."

$dockerEngineReady = $false
if ($null -ne $dockerCommand) {
  & docker info *> $null
  $dockerEngineReady = $LASTEXITCODE -eq 0
}
Add-ClearLedgerPrerequisiteCheck `
  "docker-engine" `
  $dockerEngineReady `
  "Docker is installed but its engine is not running; start Docker and retry."

$composeReady = $false
if ($null -ne $dockerCommand) {
  & docker compose version *> $null
  $composeReady = $LASTEXITCODE -eq 0
}
if (-not $composeReady) {
  $standaloneCompose = Get-Command docker-compose -ErrorAction SilentlyContinue
  if ($null -eq $standaloneCompose) {
    $standaloneCompose = Get-Command docker-compose.exe -ErrorAction SilentlyContinue
  }
  if ($null -ne $standaloneCompose) {
    & $standaloneCompose.Source version *> $null
    $composeReady = $LASTEXITCODE -eq 0
  }
}
Add-ClearLedgerPrerequisiteCheck `
  "docker-compose" `
  $composeReady `
  "Docker Compose v2 or docker-compose.exe is required."

$requiredFiles = @(
  "release-manifest.json",
  "SHA256SUMS.txt",
  "clearledger-public-beta-image.tar",
  "compose.yaml",
  "Start-ClearLedger.ps1",
  "Diagnose-ClearLedger.ps1"
)
foreach ($requiredFile in $requiredFiles) {
  $path = Join-Path $runtimeDirectory $requiredFile
  Add-ClearLedgerPrerequisiteCheck `
    "payload:$requiredFile" `
    (Test-Path -LiteralPath $path -PathType Leaf) `
    "The verified beta payload must contain $requiredFile."
}

$driveRoot = [IO.Path]::GetPathRoot($runtimeDirectory)
$drive = if ($driveRoot) { Get-PSDrive -Name $driveRoot.TrimEnd('\').TrimEnd(':') -ErrorAction SilentlyContinue } else { $null }
$freeSpaceReady = $null -ne $drive -and $drive.Free -ge ([int64]$MinimumFreeSpaceGB * 1GB)
$freeSpaceDetail = if ($null -eq $drive) {
  "The installation drive could not be inspected."
} else {
  "At least $MinimumFreeSpaceGB GB of free space is required on $driveRoot."
}
Add-ClearLedgerPrerequisiteCheck "disk-space" $freeSpaceReady $freeSpaceDetail

$manifestPath = Join-Path $runtimeDirectory "release-manifest.json"
$manifestReady = $false
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $manifestReady =
      $manifest.product -eq "ClearLedger Public Beta" -and
      [string]$manifest.version -match '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -and
      $manifest.verificationSkipped -eq $false -and
      $manifest.evidenceState -eq "verified-package-assembly"
  } catch {
    $manifestReady = $false
  }
}
Add-ClearLedgerPrerequisiteCheck `
  "verified-manifest" `
  $manifestReady `
  "The package manifest must identify a verified public-beta assembly."

$failedRequired = @($checks | Where-Object { $_.required -and -not $_.ready })
if ($Json) {
  [pscustomobject]@{
    ready = $failedRequired.Count -eq 0
    checks = @($checks | ForEach-Object { $_ })
  } | ConvertTo-Json -Depth 5
} else {
  Write-Host "ClearLedger prerequisite diagnostics"
  $checks | Format-Table -Property name, ready, detail -AutoSize | Out-Host
  if ($failedRequired.Count -eq 0) {
    Write-Host "Prerequisites ready."
  } else {
    Write-Host "Prerequisites incomplete: $($failedRequired.name -join ', ')"
  }
}
if ($failedRequired.Count -gt 0) { exit 1 }
exit 0
