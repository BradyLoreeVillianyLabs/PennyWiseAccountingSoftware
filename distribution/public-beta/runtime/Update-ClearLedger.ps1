[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PreviousInstallPath,
  [switch]$AcceptLicense,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$newEnvironmentPath = Join-Path $runtimeDirectory "beta.env"
$newStartScript = Join-Path $runtimeDirectory "Start-ClearLedger.ps1"
$newManifestPath = Join-Path $runtimeDirectory "release-manifest.json"
$newChecksumPath = Join-Path $runtimeDirectory "SHA256SUMS.txt"
$newImageArchivePath = Join-Path $runtimeDirectory "clearledger-public-beta-image.tar"
$postgresImage = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"

foreach ($newPackagePath in @($newManifestPath, $newChecksumPath, $newImageArchivePath, $newStartScript)) {
  if (-not (Test-Path -LiteralPath $newPackagePath -PathType Leaf)) {
    throw "The new package is missing $([IO.Path]::GetFileName($newPackagePath))."
  }
}
$newManifest = Get-Content -LiteralPath $newManifestPath -Raw | ConvertFrom-Json
$newVersion = [string]$newManifest.version
$newImageName = [string]$newManifest.image
if ($newManifest.product -ne "ClearLedger Public Beta" -or
    $newVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
    $newImageName -ne "clearledger/public-beta:$newVersion" -or
    $newManifest.verificationSkipped -ne $false -or
    $newManifest.evidenceState -ne "verified-package-assembly" -or
    $newManifest.artifactName -ne "ClearLedger-Public-Beta-$newVersion.zip" -or
    $newManifest.archiveFormat -ne "zip-with-docker-image-v1" -or
    $newManifest.postgresImage -ne $postgresImage -or
    $newManifest.sourceReduced -ne $true -or
    $newManifest.localBinding -ne "127.0.0.1:3000" -or
    $newManifest.localPortConfigurable -ne $true -or
    ([string]$newManifest.imageId) -notmatch '^sha256:[a-f0-9]{64}$' -or
    ([string]$newManifest.imageArchiveSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$newManifest.sbomSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$newManifest.sourceInputSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$newManifest.migrationSetSha256) -notmatch '^[a-f0-9]{64}$' -or
    [int]$newManifest.sourceInputFileCount -lt 1 -or
    [int]$newManifest.migrationCount -lt 1) {
  throw "The new release manifest is invalid or identifies an unverified package."
}
$newImageChecksumEntries = @(
  Get-Content -LiteralPath $newChecksumPath |
    Where-Object { $_ -match '^[a-fA-F0-9]{64}\s{2}clearledger-public-beta-image\.tar$' }
)
if ($newImageChecksumEntries.Count -ne 1) {
  throw "The new package checksum inventory does not identify exactly one runtime image archive."
}
$expectedImageArchiveHash = (($newImageChecksumEntries[0] -split '\s+')[0]).ToLowerInvariant()
if ($expectedImageArchiveHash -ne ([string]$newManifest.imageArchiveSha256).ToLowerInvariant() -or
    $expectedImageArchiveHash -ne
      (Get-FileHash -Algorithm SHA256 -LiteralPath $newImageArchivePath).Hash.ToLowerInvariant()) {
  throw "The new package runtime image failed its SHA-256 integrity check."
}

$previousDirectory = (Resolve-Path -LiteralPath $PreviousInstallPath).Path
$previousEnvironmentPath = Join-Path $previousDirectory "beta.env"
$previousComposePath = Join-Path $previousDirectory "compose.yaml"
$previousBackupScript = Join-Path $previousDirectory "Backup-ClearLedger.ps1"
$previousStopShareScript = Join-Path $previousDirectory "Stop-ClearLedgerShare.ps1"
$previousRestoreScript = Join-Path $previousDirectory "Restore-ClearLedger.ps1"
$previousBackupDirectory = Join-Path $previousDirectory "Backups"
foreach ($requiredPath in @(
  $previousEnvironmentPath,
  $previousComposePath,
  $previousBackupScript,
  $newStartScript
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "The update requires a complete previous and new ClearLedger installation. Missing $([IO.Path]::GetFileName($requiredPath))."
  }
}
if ([IO.Path]::GetFullPath($previousDirectory) -eq [IO.Path]::GetFullPath($runtimeDirectory)) {
  throw "Extract the new beta into a separate folder, then select the previous installation folder."
}
if (Test-Path -LiteralPath $newEnvironmentPath) {
  throw "This new folder is already initialized. Update from a fresh verified extraction."
}

Write-Host "Creating a safety backup with the previous release..."
$backupsBefore = @(
  Get-ChildItem -LiteralPath $previousBackupDirectory -Filter "ClearLedger-Backup-*.zip" -File -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName }
)
& $previousBackupScript
$safetyBackup = Get-ChildItem -LiteralPath $previousBackupDirectory -Filter "ClearLedger-Backup-*.zip" -File |
  Where-Object { $_.FullName -notin $backupsBefore } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $safetyBackup) { throw "The update safety backup could not be identified. Update stopped." }
$safetyChecksumPath = "$($safetyBackup.FullName).sha256"
if (-not (Test-Path -LiteralPath $safetyChecksumPath -PathType Leaf)) {
  throw "The update safety backup checksum is missing. Update stopped."
}
$safetyChecksumText = (Get-Content -LiteralPath $safetyChecksumPath -Raw).Trim()
$safetyChecksumMatch = [regex]::Match($safetyChecksumText, '^([a-fA-F0-9]{64})\s{2}([^\r\n]+)$')
if (-not $safetyChecksumMatch.Success -or
    $safetyChecksumMatch.Groups[2].Value -ne $safetyBackup.Name -or
    $safetyChecksumMatch.Groups[1].Value.ToLowerInvariant() -ne
      (Get-FileHash -Algorithm SHA256 -LiteralPath $safetyBackup.FullName).Hash.ToLowerInvariant()) {
  throw "The update safety backup checksum is invalid. Update stopped."
}
if (Test-Path -LiteralPath $previousStopShareScript -PathType Leaf) {
  & $previousStopShareScript -Quiet
}

function Read-ClearLedgerEnvironment([string]$Path) {
  $values = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') {
      throw "The previous ClearLedger environment file is malformed. Update stopped before changing services."
    }
    $name = $Matches[1]
    if ($values.ContainsKey($name)) {
      throw "The previous ClearLedger environment file contains a duplicate $name entry."
    }
    $values[$name] = $Matches[2]
  }
  return $values
}

function Protect-ClearLedgerSecretFile([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta updater supports Windows only." }
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $currentUser) { throw "The current Windows account could not be identified." }
  $security = New-Object System.Security.AccessControl.FileSecurity
  $security.SetAccessRuleProtection($true, $false)
  foreach ($sid in @(
    $currentUser,
    (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")),
    (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544"))
  )) {
    $security.AddAccessRule(
      (New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
      ))
    )
  }
  Set-Acl -LiteralPath $Path -AclObject $security
}

$environmentValues = Read-ClearLedgerEnvironment $previousEnvironmentPath
foreach ($requiredName in @(
  "CLEARLEDGER_DB_PASSWORD",
  "CLEARLEDGER_RUNTIME_DB_PASSWORD",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
)) {
  if (-not $environmentValues.ContainsKey($requiredName) -or
      [string]$environmentValues[$requiredName] -notmatch '^[a-f0-9]{64}$') {
    throw "The previous installation is missing a valid $requiredName. Update stopped before changing services."
  }
}
$previousLocalPort = 3000
if ($environmentValues.ContainsKey("CLEARLEDGER_LOCAL_PORT")) {
  $parsedPreviousLocalPort = 0
  if (-not [int]::TryParse([string]$environmentValues["CLEARLEDGER_LOCAL_PORT"], [ref]$parsedPreviousLocalPort) -or
      $parsedPreviousLocalPort -lt 1024 -or
      $parsedPreviousLocalPort -gt 65535) {
    throw "The previous installation has an invalid CLEARLEDGER_LOCAL_PORT. Update stopped before changing services."
  }
  $previousLocalPort = $parsedPreviousLocalPort
}
$previousComposeProjectName = if ($environmentValues.ContainsKey("CLEARLEDGER_COMPOSE_PROJECT_NAME")) {
  [string]$environmentValues["CLEARLEDGER_COMPOSE_PROJECT_NAME"]
} else {
  "clearledger-beta"
}
if ($previousComposeProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
  throw "The previous installation has an invalid CLEARLEDGER_COMPOSE_PROJECT_NAME. Update stopped before changing services."
}
$environmentValues["CLEARLEDGER_IMAGE"] = $newImageName
$environmentValues["CLEARLEDGER_COMPOSE_PROJECT_NAME"] = $previousComposeProjectName
$environmentValues["CLEARLEDGER_LOCAL_PORT"] = [string]$previousLocalPort
$newEnvironmentLines = @(
    "CLEARLEDGER_IMAGE=$($environmentValues['CLEARLEDGER_IMAGE'])",
    "CLEARLEDGER_COMPOSE_PROJECT_NAME=$($environmentValues['CLEARLEDGER_COMPOSE_PROJECT_NAME'])",
    "CLEARLEDGER_LOCAL_PORT=$($environmentValues['CLEARLEDGER_LOCAL_PORT'])",
    "CLEARLEDGER_DB_PASSWORD=$($environmentValues['CLEARLEDGER_DB_PASSWORD'])",
    "CLEARLEDGER_RUNTIME_DB_PASSWORD=$($environmentValues['CLEARLEDGER_RUNTIME_DB_PASSWORD'])",
    "WEBHOOK_SECRET_ENCRYPTION_SECRET=$($environmentValues['WEBHOOK_SECRET_ENCRYPTION_SECRET'])",
    "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET=$($environmentValues['CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET'])",
    "PAYMENT_WEBHOOK_SECRET=$($environmentValues['PAYMENT_WEBHOOK_SECRET'])",
    "PAYMENT_ACCOUNT_ENCRYPTION_SECRET=$($environmentValues['PAYMENT_ACCOUNT_ENCRYPTION_SECRET'])"
)
$temporaryEnvironmentPath = Join-Path $runtimeDirectory ".beta-env-update-$PID-$([Guid]::NewGuid().ToString('N')).tmp"
try {
  [System.IO.File]::WriteAllLines($temporaryEnvironmentPath, $newEnvironmentLines)
  Protect-ClearLedgerSecretFile $temporaryEnvironmentPath
  [System.IO.File]::Move($temporaryEnvironmentPath, $newEnvironmentPath)
} finally {
  if (Test-Path -LiteralPath $temporaryEnvironmentPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryEnvironmentPath -Force
  }
}

Write-Host "Stopping the previous release without deleting its data..."
Set-Location -LiteralPath $previousDirectory
$previousComposeArguments = @(
  "compose",
  "--project-name", $previousComposeProjectName,
  "--env-file", $previousEnvironmentPath,
  "--file", $previousComposePath
)
Invoke-ClearLedgerCompose @previousComposeArguments down
if ($LASTEXITCODE -ne 0) { throw "The previous release could not be stopped safely." }

Set-Location -LiteralPath $runtimeDirectory
try {
  $startArguments = @{}
  if ($AcceptLicense) { $startArguments['AcceptLicense'] = $true }
  if ($NoBrowser) { $startArguments['NoBrowser'] = $true }
  $startArguments['ComposeProjectName'] = $previousComposeProjectName
  & $newStartScript @startArguments
} catch {
  Write-Warning "The new release did not become healthy. Do not start the old binary against a database that may contain newer migrations."
  Write-Host "Verified pre-update backup: $($safetyBackup.FullName)"
  if (Test-Path -LiteralPath $previousRestoreScript -PathType Leaf) {
    Write-Host "Rollback: run the previous folder's Restore-ClearLedger.ps1 with this backup, then reconcile before resuming."
  } else {
    Write-Host "Preserve both installation folders and the backup, then use the documented recovery procedure before retrying."
  }
  throw
}
Write-Host "Update complete. The verified safety backup remains in the previous installation's Backups folder."
Write-Host "Pre-update recovery point: $($safetyBackup.FullName)"
Write-Host "Reconcile control reports before resuming normal entry."
