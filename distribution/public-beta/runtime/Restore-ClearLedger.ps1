[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupZip,
  [switch]$ConfirmRestore,
  [switch]$SkipSafetyBackup,
  [switch]$InternalSafetyRecovery
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$backupScript = Join-Path $runtimeDirectory "Backup-ClearLedger.ps1"
$stopShareScript = Join-Path $runtimeDirectory "Stop-ClearLedgerShare.ps1"
$restoreRoot = Join-Path $runtimeDirectory "Restore-Staging"
$restoreScriptPath = $MyInvocation.MyCommand.Path
$backupDirectory = Join-Path $runtimeDirectory "Backups"

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

function Protect-ClearLedgerRestoreDirectory([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta restore tool supports Windows only." }
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($null -eq $currentUser) { throw "The current Windows account could not be identified." }
  $security = New-Object System.Security.AccessControl.DirectorySecurity
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
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
          [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
      ))
    )
  }
  Set-Acl -LiteralPath $Path -AclObject $security
}

function Test-ClearLedgerServiceRunning([string[]]$ComposeArguments, [string]$Service) {
  $serviceContainer = (Invoke-ClearLedgerCompose @ComposeArguments ps -q $Service 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The $Service service state could not be read safely." }
  return -not [string]::IsNullOrWhiteSpace($serviceContainer)
}

function Set-ClearLedgerServiceState(
  [string[]]$ComposeArguments,
  [bool]$PostgresWasRunning,
  [bool]$ApiWasRunning,
  [bool]$WebWasRunning
) {
  if ($WebWasRunning) {
    Invoke-ClearLedgerCompose @ComposeArguments up --detach
  } elseif ($ApiWasRunning) {
    Invoke-ClearLedgerCompose @ComposeArguments stop web *> $null
    if ($LASTEXITCODE -eq 0) { Invoke-ClearLedgerCompose @ComposeArguments up --detach api }
  } elseif ($PostgresWasRunning) {
    Invoke-ClearLedgerCompose @ComposeArguments stop web api *> $null
    if ($LASTEXITCODE -eq 0) { Invoke-ClearLedgerCompose @ComposeArguments up --detach postgres }
  } else {
    Invoke-ClearLedgerCompose @ComposeArguments down
  }
  if ($LASTEXITCODE -ne 0) {
    throw "The pre-restore ClearLedger service state could not be recovered."
  }
}

if (-not (Test-Path -LiteralPath $environmentPath)) {
  throw "Initialize this ClearLedger installation with Start-ClearLedger.ps1 before restoring a backup."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to restore ClearLedger."
}
$composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath
$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath
)
$resolvedBackup = (Resolve-Path -LiteralPath $BackupZip).Path
if ([IO.Path]::GetExtension($resolvedBackup) -ine ".zip") {
  throw "Select an unmodified ClearLedger .zip backup."
}

$hashPath = "$resolvedBackup.sha256"
if (-not (Test-Path -LiteralPath $hashPath)) {
  throw "The backup checksum file is missing. Keep the .zip and matching .zip.sha256 together."
}
$checksumText = (Get-Content -LiteralPath $hashPath -Raw).Trim()
$checksumMatch = [regex]::Match($checksumText, '^([a-fA-F0-9]{64})\s{2}([^\r\n]+)$')
if (-not $checksumMatch.Success -or
    $checksumMatch.Groups[2].Value -ne [IO.Path]::GetFileName($resolvedBackup)) {
  throw "The backup checksum file is malformed or names another archive."
}
$expectedHash = $checksumMatch.Groups[1].Value.ToLowerInvariant()
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedBackup).Hash.ToLowerInvariant()
if ($expectedHash -ne $actualHash) { throw "The backup SHA-256 does not match. Restore was refused." }

if (-not $ConfirmRestore) {
  Write-Warning "Restore replaces the current ClearLedger database and stored documents."
  $answer = Read-Host "Type RESTORE to continue"
  if ($answer -cne "RESTORE") { throw "Restore cancelled without changing ClearLedger." }
}

Set-Location -LiteralPath $runtimeDirectory
$postgresWasRunning = Test-ClearLedgerServiceRunning $composeArguments "postgres"
$apiWasRunning = Test-ClearLedgerServiceRunning $composeArguments "api"
$webWasRunning = Test-ClearLedgerServiceRunning $composeArguments "web"
$safetyBackup = $null
$removeSafetyBackupAfterSuccess = $SkipSafetyBackup -and -not $InternalSafetyRecovery
if (-not $InternalSafetyRecovery) {
  Write-Host "Creating a safety backup of the current installation first..."
  $backupsBefore = @(
    Get-ChildItem -LiteralPath $backupDirectory -Filter "ClearLedger-Backup-*.zip" -File -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName }
  )
  & $backupScript
  $safetyBackup = Get-ChildItem -LiteralPath $backupDirectory -Filter "ClearLedger-Backup-*.zip" -File |
    Where-Object { $_.FullName -notin $backupsBefore } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $safetyBackup -or
      -not (Test-Path -LiteralPath "$($safetyBackup.FullName).sha256" -PathType Leaf)) {
    throw "The restore safety backup could not be identified with its checksum. Restore stopped before changing data."
  }
}
if (Test-Path -LiteralPath $stopShareScript -PathType Leaf) { & $stopShareScript -Quiet }

New-Item -ItemType Directory -Path $restoreRoot -Force | Out-Null
$stageDirectory = Join-Path $restoreRoot ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stageDirectory | Out-Null
Protect-ClearLedgerRestoreDirectory $stageDirectory
$postgresContainer = $null
$containerDump = $null
$runtimeMutationStarted = $false
$dataMutationStarted = $false
try {
[System.Reflection.Assembly]::LoadWithPartialName("System.IO.Compression.FileSystem") | Out-Null
$backupStream = [System.IO.File]::Open(
  $resolvedBackup,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::Read,
  [System.IO.FileShare]::Read
)
try {
  $pinnedHasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $pinnedHash = ([BitConverter]::ToString($pinnedHasher.ComputeHash($backupStream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $pinnedHasher.Dispose()
  }
  if ($pinnedHash -ne $expectedHash) {
    throw "The backup changed after its initial checksum validation. Restore was refused."
  }
  $backupStream.Position = 0
  $zip = [System.IO.Compression.ZipArchive]::new(
    $backupStream,
    [System.IO.Compression.ZipArchiveMode]::Read,
    $true
  )
  try {
    if ($zip.Entries.Count -gt 200000) { throw "The backup contains too many entries." }
    [Int64]$expandedBytes = 0
    $expandedRoot = [IO.Path]::GetFullPath($stageDirectory) + [IO.Path]::DirectorySeparatorChar
    $seenEntries = @{}
    $allowedTopLevelEntries = @{
      "backup-manifest.json" = $true
      "clearledger.dump" = $true
      "beta.env.recovery" = $true
      "files" = $true
    }
    foreach ($entry in $zip.Entries) {
      $portableEntryName = $entry.FullName.Replace('\', '/').TrimEnd('/')
      if ([string]::IsNullOrWhiteSpace($portableEntryName) -or
          [IO.Path]::IsPathRooted($entry.FullName) -or
          $entry.FullName.Contains(":")) {
        throw "The backup contains an unsafe absolute entry."
      }
      $entryParts = @($portableEntryName.Split('/'))
      if ($entryParts | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -eq "." -or $_ -eq ".." }) {
        throw "The backup contains an unsafe relative entry."
      }
      $entryKey = $portableEntryName.ToLowerInvariant()
      if ($seenEntries.ContainsKey($entryKey)) { throw "The backup contains duplicate entry paths." }
      $seenEntries[$entryKey] = $true
      $topLevelEntry = $entryParts[0].ToLowerInvariant()
      if (-not $allowedTopLevelEntries.ContainsKey($topLevelEntry) -or
          ($topLevelEntry -ne "files" -and $portableEntryName -ne $topLevelEntry)) {
        throw "The backup contains an unexpected entry: $portableEntryName"
      }
      $entryTarget = [IO.Path]::GetFullPath((Join-Path $stageDirectory $entry.FullName))
      if (-not $entryTarget.StartsWith($expandedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The backup contains an unsafe path traversal entry."
      }
      $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixFileType -eq 0xA000) { throw "Symbolic links are not accepted in a backup." }
      if ($unixFileType -ne 0 -and $unixFileType -ne 0x4000 -and $unixFileType -ne 0x8000) {
        throw "The backup contains an unsupported filesystem entry."
      }
      if ($entry.Length -gt 25GB) { throw "One backup entry exceeds the supported size." }
      if ($entry.Length -gt [Math]::Max(1MB, [double]$entry.CompressedLength * 500)) {
        throw "One backup entry has an unsafe expansion ratio."
      }
      $expandedBytes += $entry.Length
      if ($expandedBytes -gt 100GB) { throw "The expanded backup exceeds the supported size." }
    }
    if ($expandedBytes -gt [Math]::Max(1GB, (Get-Item -LiteralPath $resolvedBackup).Length * 500)) {
      throw "The backup expansion ratio is unsafe."
    }
    $stageDriveName = [IO.Path]::GetPathRoot($stageDirectory).TrimEnd('\').TrimEnd(':')
    $stageDrive = Get-PSDrive -Name $stageDriveName
    if ($null -eq $stageDrive -or $stageDrive.Free -lt ($expandedBytes + 1GB)) {
      throw "The restore drive does not have enough free space to stage this backup safely."
    }

    foreach ($entry in $zip.Entries) {
      $entryTarget = [IO.Path]::GetFullPath((Join-Path $stageDirectory $entry.FullName))
      $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      $isDirectory = $entry.FullName.EndsWith('/') -or
        $entry.FullName.EndsWith('\') -or
        $unixFileType -eq 0x4000
      if ($isDirectory) {
        [System.IO.Directory]::CreateDirectory($entryTarget) | Out-Null
        continue
      }
      [System.IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($entryTarget)) | Out-Null
      $entryStream = $entry.Open()
      $outputStream = $null
      try {
        $outputStream = [System.IO.File]::Open(
          $entryTarget,
          [System.IO.FileMode]::CreateNew,
          [System.IO.FileAccess]::Write,
          [System.IO.FileShare]::None
        )
        $entryStream.CopyTo($outputStream)
      } finally {
        if ($outputStream) { $outputStream.Dispose() }
        $entryStream.Dispose()
      }
    }
  } finally {
    $zip.Dispose()
  }
} finally {
  $backupStream.Dispose()
}

$manifestPath = Join-Path $stageDirectory "backup-manifest.json"
$databasePath = Join-Path $stageDirectory "clearledger.dump"
$filesDirectory = Join-Path $stageDirectory "files"
$recoveryEnvironmentPath = Join-Path $stageDirectory "beta.env.recovery"
foreach ($requiredPath in @($manifestPath, $databasePath, $filesDirectory, $recoveryEnvironmentPath)) {
  $expectedPathType = if ($requiredPath -eq $filesDirectory) { "Container" } else { "Leaf" }
  if (-not (Test-Path -LiteralPath $requiredPath -PathType $expectedPathType)) {
    throw "The selected archive is not a complete ClearLedger backup. Missing $([IO.Path]::GetFileName($requiredPath))."
  }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.format -ne "clearledger-public-beta-backup-v1" -or
    $manifest.includesDocuments -ne $true -or
    $manifest.includesRecoverySecrets -ne $true -or
    ([string]$manifest.databaseSha256) -notmatch '^[a-f0-9]{64}$') {
  throw "The selected backup format is unsupported."
}
$databaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $databasePath).Hash.ToLowerInvariant()
if ($databaseHash -ne ([string]$manifest.databaseSha256).ToLowerInvariant()) {
  throw "The database archive failed its integrity check. Restore was refused."
}

function Read-EnvironmentFile([string]$Path) {
  $values = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') {
      throw "A ClearLedger recovery environment file is malformed."
    }
    $name = $Matches[1]
    if ($values.ContainsKey($name)) {
      throw "A ClearLedger recovery environment file contains a duplicate $name entry."
    }
    $values[$name] = $Matches[2]
  }
  return $values
}

function Protect-ClearLedgerSecretFile([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta restore tool supports Windows only." }
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

$currentEnvironment = Read-EnvironmentFile $environmentPath
$recoveryEnvironment = Read-EnvironmentFile $recoveryEnvironmentPath
$activeComposeProjectName = if ($currentEnvironment.ContainsKey("CLEARLEDGER_COMPOSE_PROJECT_NAME")) {
  [string]$currentEnvironment["CLEARLEDGER_COMPOSE_PROJECT_NAME"]
} else {
  "clearledger-beta"
}
if ($activeComposeProjectName -ne $composeProjectName -or
    $activeComposeProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
  throw "The active installation Compose project identity changed during restore validation."
}
$currentEnvironment["CLEARLEDGER_COMPOSE_PROJECT_NAME"] = $activeComposeProjectName
foreach ($secretName in @(
  "CLEARLEDGER_RUNTIME_DB_PASSWORD",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
)) {
  if (-not $recoveryEnvironment.ContainsKey($secretName) -or
      [string]$recoveryEnvironment[$secretName] -notmatch '^[a-f0-9]{64}$') {
    throw "The backup is missing the $secretName recovery secret."
  }
  $currentEnvironment[$secretName] = $recoveryEnvironment[$secretName]
}
$requiredEnvironmentNames = @(
  "CLEARLEDGER_IMAGE",
  "CLEARLEDGER_DB_PASSWORD",
  "CLEARLEDGER_RUNTIME_DB_PASSWORD",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
)
foreach ($requiredEnvironmentName in $requiredEnvironmentNames) {
  if (-not $currentEnvironment.ContainsKey($requiredEnvironmentName) -or
      [string]::IsNullOrWhiteSpace([string]$currentEnvironment[$requiredEnvironmentName])) {
    throw "The active installation is missing $requiredEnvironmentName. Restore stopped before replacing the database."
  }
}
if ([string]$currentEnvironment["CLEARLEDGER_IMAGE"] -notmatch '^clearledger/public-beta:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
    [string]$currentEnvironment["CLEARLEDGER_DB_PASSWORD"] -notmatch '^[a-f0-9]{64}$') {
  throw "The active installation image or database secret is invalid. Restore stopped before replacing the database."
}
$effectiveLocalPort = 3000
if ($currentEnvironment.ContainsKey("CLEARLEDGER_LOCAL_PORT")) {
  $parsedLocalPort = 0
  if (-not [int]::TryParse([string]$currentEnvironment["CLEARLEDGER_LOCAL_PORT"], [ref]$parsedLocalPort) -or
      $parsedLocalPort -lt 1024 -or
      $parsedLocalPort -gt 65535) {
    throw "The active installation has an invalid CLEARLEDGER_LOCAL_PORT. Restore stopped before replacing the database."
  }
  $effectiveLocalPort = $parsedLocalPort
}
$currentEnvironment["CLEARLEDGER_LOCAL_PORT"] = [string]$effectiveLocalPort
$environmentOutputNames = @(
  "CLEARLEDGER_IMAGE",
  "CLEARLEDGER_COMPOSE_PROJECT_NAME",
  "CLEARLEDGER_LOCAL_PORT",
  "CLEARLEDGER_DB_PASSWORD",
  "CLEARLEDGER_RUNTIME_DB_PASSWORD",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
)
$updatedEnvironmentLines = @(
  $environmentOutputNames | ForEach-Object { "$_=$($currentEnvironment[$_])" }
)

$runtimeMutationStarted = $true
Invoke-ClearLedgerCompose @composeArguments stop web api migrate *> $null
if ($LASTEXITCODE -ne 0) { throw "ClearLedger services could not be stopped safely for restore." }
Invoke-ClearLedgerCompose @composeArguments up --detach postgres
if ($LASTEXITCODE -ne 0) { throw "The private database could not be started for restore." }
$databaseReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Invoke-ClearLedgerCompose @composeArguments exec -T postgres pg_isready -U clearledger -d clearledger *> $null
  if ($LASTEXITCODE -eq 0) { $databaseReady = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $databaseReady) { throw "The private database did not become ready for restore." }

$postgresContainer = (Invoke-ClearLedgerCompose @composeArguments ps -q postgres | Out-String).Trim()
if (-not $postgresContainer) { throw "The private database container was not found." }
$containerDump = "/tmp/clearledger-restore-$([Guid]::NewGuid().ToString('N')).dump"
docker cp $databasePath "${postgresContainer}:$containerDump"
if ($LASTEXITCODE -ne 0) { throw "The backup could not be copied to the private database." }

Invoke-ClearLedgerCompose @composeArguments exec -T postgres psql -U clearledger -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'clearledger' AND pid <> pg_backend_pid();"
if ($LASTEXITCODE -ne 0) { throw "Active database sessions could not be closed." }
$dataMutationStarted = $true
Invoke-ClearLedgerCompose @composeArguments exec -T postgres dropdb -U clearledger --if-exists clearledger
if ($LASTEXITCODE -ne 0) { throw "The current database could not be replaced." }
Invoke-ClearLedgerCompose @composeArguments exec -T postgres createdb -U clearledger clearledger
if ($LASTEXITCODE -ne 0) { throw "A clean database could not be created." }
Invoke-ClearLedgerCompose @composeArguments exec -T postgres pg_restore -U clearledger -d clearledger --no-owner --exit-on-error $containerDump
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL rejected the backup archive." }
Invoke-ClearLedgerCompose @composeArguments exec -T postgres rm -f -- $containerDump

Invoke-ClearLedgerCompose @composeArguments run --rm --no-deps --user 0:0 --entrypoint sh api -c "find /app/.data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +"
if ($LASTEXITCODE -ne 0) { throw "The existing document volume could not be prepared." }
Invoke-ClearLedgerCompose @composeArguments run --rm --no-deps --user 0:0 --entrypoint sh --volume "${filesDirectory}:/restore:ro" api -c "cp -a /restore/. /app/.data/ && chown -R node:node /app/.data"
if ($LASTEXITCODE -ne 0) { throw "The document archive could not be restored." }

# Switch encryption/signing secrets only after the matching database and documents
# are in place. A validation or database-copy failure therefore cannot poison the
# active installation's next restart with secrets from another backup. Replace the
# file atomically so an interrupted write cannot leave a partial secret set.
$temporaryEnvironmentPath = Join-Path $stageDirectory "beta.env.next"
$rollbackEnvironmentPath = Join-Path $stageDirectory "beta.env.previous"
[System.IO.File]::WriteAllLines($temporaryEnvironmentPath, $updatedEnvironmentLines)
Protect-ClearLedgerSecretFile $temporaryEnvironmentPath
[System.IO.File]::Replace(
  $temporaryEnvironmentPath,
  $environmentPath,
  $rollbackEnvironmentPath,
  $true
)

# A completed one-shot migration container would otherwise be reused after an older
# database is restored. Removing it forces the current release to apply every pending
# forward migration before the API is allowed to start.
Invoke-ClearLedgerCompose @composeArguments rm --force --stop migrate runtime_role *> $null
if ($LASTEXITCODE -ne 0) { throw "The migration service could not be prepared after restore." }
Invoke-ClearLedgerCompose @composeArguments up --detach
if ($LASTEXITCODE -ne 0) { throw "The restored ClearLedger services did not start." }

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$effectiveLocalPort/" -TimeoutSec 3
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$effectiveLocalPort/api/health" -TimeoutSec 3
    if ($response.StatusCode -eq 200 -and $health.status -eq "ok") {
      $ready = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (-not $ready) {
  throw "The restore completed, but ClearLedger web/API health did not recover."
}

} catch {
  $primaryFailure = $_.Exception.Message
  $recoveryFailure = $null
  if ($runtimeMutationStarted) {
    try {
      if ($dataMutationStarted) {
        if (-not $safetyBackup) {
          throw "No safety backup is available for automatic data recovery."
        }
        Write-Warning "Restore failed after data replacement began. Restoring the automatic safety backup now..."
        & $restoreScriptPath `
          -BackupZip $safetyBackup.FullName `
          -ConfirmRestore `
          -SkipSafetyBackup `
          -InternalSafetyRecovery
      }
      Set-ClearLedgerServiceState `
        -ComposeArguments $composeArguments `
        -PostgresWasRunning $postgresWasRunning `
        -ApiWasRunning $apiWasRunning `
        -WebWasRunning $webWasRunning
    } catch {
      $recoveryFailure = $_.Exception.Message
    }
  }
  if ($recoveryFailure) {
    $safetyLocation = if ($safetyBackup) { $safetyBackup.FullName } else { "unavailable" }
    throw "Restore failed: $primaryFailure Automatic safety recovery also failed: $recoveryFailure Safety backup: $safetyLocation"
  }
  if ($runtimeMutationStarted) {
    throw "Restore failed, but ClearLedger automatically returned to the pre-restore safety state. Original error: $primaryFailure"
  }
  throw
} finally {
  if ($postgresContainer) {
    Invoke-ClearLedgerCompose @composeArguments exec -T postgres rm -f -- $containerDump *> $null
  }
  if (Test-Path -LiteralPath $stageDirectory) {
    $resolvedStage = [IO.Path]::GetFullPath($stageDirectory)
    $resolvedRestoreRoot = [IO.Path]::GetFullPath($restoreRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($resolvedRestoreRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a staging directory outside the ClearLedger restore folder."
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}
if ($removeSafetyBackupAfterSuccess -and $safetyBackup) {
  try {
    Remove-Item -LiteralPath $safetyBackup.FullName -Force
    Remove-Item -LiteralPath "$($safetyBackup.FullName).sha256" -Force
  } catch {
    Write-Warning "Restore succeeded, but its temporary safety backup could not be removed: $($_.Exception.Message)"
  }
}
Write-Host "ClearLedger was restored successfully from $resolvedBackup"
Write-Host "Open http://localhost:$effectiveLocalPort and reconcile control reports before resuming entries."
