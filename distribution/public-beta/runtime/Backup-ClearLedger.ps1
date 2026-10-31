[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$stopShareScript = Join-Path $runtimeDirectory "Stop-ClearLedgerShare.ps1"
$backupDirectory = Join-Path $runtimeDirectory "Backups"

function Protect-ClearLedgerBackupFile([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta backup tool supports Windows only." }
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

function Protect-ClearLedgerBackupDirectory([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta backup tool supports Windows only." }
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

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw "ClearLedger has not been initialized. Run Start-ClearLedger.ps1 first."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required to back up ClearLedger."
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

$postgresWasRunning = -not [string]::IsNullOrWhiteSpace((
  Invoke-ClearLedgerCompose @composeArguments ps -q postgres 2>$null | Out-String
).Trim())
$apiWasRunning = -not [string]::IsNullOrWhiteSpace((
  Invoke-ClearLedgerCompose @composeArguments ps -q api 2>$null | Out-String
).Trim())
$webWasRunning = -not [string]::IsNullOrWhiteSpace((
  Invoke-ClearLedgerCompose @composeArguments ps -q web 2>$null | Out-String
).Trim())

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
$stamp = [DateTimeOffset]::Now.ToString("yyyyMMdd-HHmmss")
$uniqueId = [Guid]::NewGuid().ToString("N").Substring(0, 10)
$stageDirectory = Join-Path $backupDirectory ".staging-$stamp-$uniqueId"
$filesDirectory = Join-Path $stageDirectory "files"
$archivePath = Join-Path $backupDirectory "ClearLedger-Backup-$stamp-$uniqueId.zip"
$checksumPath = "$archivePath.sha256"
$containerDump = "/tmp/clearledger-$stamp-$uniqueId.dump"
$backupSucceeded = $false
New-Item -ItemType Directory -Path $stageDirectory | Out-Null
Protect-ClearLedgerBackupDirectory $stageDirectory

try {
  Write-Host "Pausing local and remote writes while a consistent backup is captured..."
  Invoke-ClearLedgerCompose @composeArguments stop web api *> $null
  if ($LASTEXITCODE -ne 0) { throw "ClearLedger write services could not be paused for backup." }
  Invoke-ClearLedgerCompose @composeArguments up --detach postgres *> $null
  if ($LASTEXITCODE -ne 0) { throw "The private database could not be started for backup." }

  $databaseReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Invoke-ClearLedgerCompose @composeArguments exec -T postgres pg_isready -U clearledger -d clearledger *> $null
    if ($LASTEXITCODE -eq 0) { $databaseReady = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $databaseReady) { throw "The private database did not become ready for backup." }

  New-Item -ItemType Directory -Path $filesDirectory -Force | Out-Null
  Invoke-ClearLedgerCompose @composeArguments exec -T postgres pg_dump -U clearledger -d clearledger -Fc -f $containerDump
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL could not create the backup." }

  $postgresContainer = (Invoke-ClearLedgerCompose @composeArguments ps -q postgres | Out-String).Trim()
  if (-not $postgresContainer) { throw "The ClearLedger database container was not found." }
  docker cp "${postgresContainer}:$containerDump" (Join-Path $stageDirectory "clearledger.dump")
  if ($LASTEXITCODE -ne 0) { throw "The database archive could not be copied from the private database." }

  Invoke-ClearLedgerCompose @composeArguments run --rm --no-deps --user 0:0 --entrypoint sh --volume "${filesDirectory}:/backup" api -c "cp -a /app/.data/. /backup/"
  if ($LASTEXITCODE -ne 0) { throw "The document archive could not be copied." }

  Copy-Item -LiteralPath $environmentPath -Destination (Join-Path $stageDirectory "beta.env.recovery")
  $databaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stageDirectory "clearledger.dump")).Hash.ToLowerInvariant()
  $metadata = [ordered]@{
    format = "clearledger-public-beta-backup-v1"
    createdAt = [DateTimeOffset]::Now.ToString("o")
    composeProjectName = $composeProjectName
    databaseSha256 = $databaseHash
    includesDocuments = $true
    includesRecoverySecrets = $true
    warning = "Contains private business data and recovery secrets. Store securely."
  }
  $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stageDirectory "backup-manifest.json") -Encoding UTF8

  [System.Reflection.Assembly]::LoadWithPartialName("System.IO.Compression.FileSystem") | Out-Null
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageDirectory,
    $archivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  Protect-ClearLedgerBackupFile $archivePath
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($checksumPath, "$archiveHash  $([IO.Path]::GetFileName($archivePath))`r`n")
  Protect-ClearLedgerBackupFile $checksumPath
  $backupSucceeded = $true
} finally {
  Invoke-ClearLedgerCompose @composeArguments exec -T postgres rm -f -- $containerDump *> $null

  if (Test-Path -LiteralPath $stageDirectory) {
    $resolvedStage = [IO.Path]::GetFullPath($stageDirectory)
    $resolvedBackupRoot = [IO.Path]::GetFullPath($backupDirectory) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($resolvedBackupRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a staging directory outside the ClearLedger backup folder."
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
  if (-not $backupSucceeded) {
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) { Remove-Item -LiteralPath $archivePath -Force }
    if (Test-Path -LiteralPath $checksumPath -PathType Leaf) { Remove-Item -LiteralPath $checksumPath -Force }
  }

  if ($webWasRunning) {
    Invoke-ClearLedgerCompose @composeArguments up --detach web *> $null
    if ($LASTEXITCODE -ne 0) { throw "The backup finished, but the local web service could not be restarted." }
  } elseif ($apiWasRunning) {
    Invoke-ClearLedgerCompose @composeArguments up --detach api *> $null
    if ($LASTEXITCODE -ne 0) { throw "The backup finished, but the local API service could not be restarted." }
  } elseif (-not $postgresWasRunning) {
    Invoke-ClearLedgerCompose @composeArguments stop postgres *> $null
    if ($LASTEXITCODE -ne 0) { throw "The temporary backup database service could not be stopped." }
  }
}

Write-Host "Backup created: $archivePath"
Write-Host "SHA-256: $archiveHash"
Write-Warning "The backup contains business data and recovery secrets. Copy it to protected storage."
