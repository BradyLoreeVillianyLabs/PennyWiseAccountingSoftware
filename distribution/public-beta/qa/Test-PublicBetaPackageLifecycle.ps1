[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackageZip,
  [ValidateRange(1024, 65535)]
  [int]$LocalPort = 32980,
  [ValidateRange(1024, 65535)]
  [int]$SharePort = 32981,
  [string]$ShareSubdomain,
  [string]$PreviousImage = "clearledger/public-beta:0.14.0-rc.1-prefinal-20260803",
  [string]$ExpectedPreviousImageId = "sha256:20a54be774c902cec0cca12e1fd1c5a70694245f1c3ae4adcf6439924ab696d8",
  [string]$ReportPath,
  [switch]$KeepWorkspaceOnFailure
)

$ErrorActionPreference = "Stop"
$qaSourceDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
  $ReportPath = Join-Path $qaSourceDirectory "PACKAGE_LIFECYCLE_DRILL.txt"
}
if ($LocalPort -eq $SharePort) { throw "LocalPort and SharePort must be different." }
if ($PreviousImage -notmatch '^clearledger/public-beta:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
  throw "PreviousImage must identify an explicit ClearLedger public-beta image tag."
}
if ($ExpectedPreviousImageId -notmatch '^sha256:[a-f0-9]{64}$') {
  throw "ExpectedPreviousImageId must be an exact lowercase Docker image ID."
}

$resolvedArchive = (Resolve-Path -LiteralPath $PackageZip).Path
$checksumPath = "$resolvedArchive.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "The final package sibling .zip.sha256 file is required."
}
$checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
$checksumMatch = [regex]::Match($checksumText, '^([a-fA-F0-9]{64})\s{2}([^\r\n]+)$')
if (-not $checksumMatch.Success -or
    $checksumMatch.Groups[2].Value -ne [IO.Path]::GetFileName($resolvedArchive)) {
  throw "The final package checksum file is malformed or names another archive."
}
$archiveHash = (Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveHash -ne $checksumMatch.Groups[1].Value.ToLowerInvariant()) {
  throw "The final package ZIP does not match its sibling SHA-256."
}
foreach ($requiredCommand in @("docker", "loclx")) {
  if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue) -and
      -not (Get-Command "$requiredCommand.exe" -ErrorAction SilentlyContinue)) {
    throw "$requiredCommand is required for the complete package lifecycle drill."
  }
}

# Docker Desktop on Windows may expose Compose as either the v2 plugin
# (`docker compose`) or the standalone compatibility executable
# (`docker-compose.exe`).  Keep the lifecycle drill portable across both
# installations without weakening any of the scoped project checks below.
$composeExecutable = if (Get-Command "docker-compose.exe" -ErrorAction SilentlyContinue) {
  "docker-compose.exe"
} elseif (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
  "docker-compose"
} else {
  "docker"
}
$composePrefix = if ($composeExecutable -eq "docker") { @("compose") } else { @() }
function Invoke-ClearLedgerCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $composeOutput = @(& $composeExecutable @composePrefix @Arguments 2>&1)
    foreach ($entry in $composeOutput) {
      if ($entry -is [System.Management.Automation.ErrorRecord]) {
        Write-Host $entry.ToString()
      } else {
        Write-Output $entry
      }
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker is installed but its engine is not ready." }
$actualPreviousImageId = (
  docker image inspect --format '{{.Id}}' $PreviousImage 2>$null | Out-String
).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $actualPreviousImageId -ne $ExpectedPreviousImageId) {
  throw "The exact preserved preceding image $PreviousImage ($ExpectedPreviousImageId) is required locally. The drill will not pull or substitute an unverified predecessor."
}
foreach ($port in @($LocalPort, $SharePort)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
    throw "QA port $port is already in use. Select two unused ports."
  }
}

$runId = [Guid]::NewGuid().ToString("N").Substring(0, 12)
$qaProjectName = "clearledger-beta-qa-$runId"
if ($qaProjectName -notmatch '^clearledger-beta-qa-[a-f0-9]{12}$') {
  throw "The isolated QA project name is invalid."
}
$qaVolumeNames = [ordered]@{
  clearledger_database = "${qaProjectName}_clearledger_database"
  clearledger_files = "${qaProjectName}_clearledger_files"
}
if ([string]::IsNullOrWhiteSpace($ShareSubdomain)) {
  $ShareSubdomain = "clearledgerqa$runId"
}
if ($ShareSubdomain -notmatch '^[a-z0-9]{3,63}$') {
  throw "ShareSubdomain must use the lowercase alphanumeric LocalXpose temporary-domain format."
}

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$workspace = Join-Path $temporaryBase "ClearLedgerPublicBetaQa-$runId"
$workspaceFull = [IO.Path]::GetFullPath($workspace)
if (-not $workspaceFull.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($workspaceFull) -ne "ClearLedgerPublicBetaQa-$runId") {
  throw "The isolated QA workspace path is unsafe."
}
$reportFull = [IO.Path]::GetFullPath($ReportPath)
if ($reportFull.StartsWith($workspaceFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "ReportPath must be outside the disposable QA workspace."
}
$oldExtraction = Join-Path $workspaceFull "old"
$newExtraction = Join-Path $workspaceFull "new"
$evidence = [System.Collections.Generic.List[string]]::new()
$succeeded = $false
$caughtFailure = $null
$cleanupSucceeded = $true
$cleanupFailures = [System.Collections.Generic.List[string]]::new()
$shareJob = $null
$activeInstall = $null
$priorLoclxIds = @(Get-Process -Name loclx -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)

function Add-Evidence([string]$Message) {
  $script:evidence.Add("$([DateTimeOffset]::Now.ToString('u')) $Message")
  Write-Host $Message
}

function New-QaHexSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Protect-QaSecretFile([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "The package lifecycle drill supports Windows only." }
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

function Get-ProjectContainerIds([string]$ProjectName) {
  $ids = @(
    docker ps --all --quiet --filter "label=com.docker.compose.project=$ProjectName" 2>$null
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($LASTEXITCODE -ne 0) { throw "Docker could not inspect the isolated QA project containers." }
  return $ids
}

function Assert-ProjectContainersAbsent([string]$ProjectName) {
  $containers = @(Get-ProjectContainerIds $ProjectName)
  if ($containers.Count -ne 0) { throw "The isolated QA project still has containers." }
}

function Get-ProjectVolumeState([string]$ProjectName, [string]$LogicalName, [string]$VolumeName) {
  $listedNames = @(
    docker volume ls --quiet --filter "name=$VolumeName" 2>$null
  ) | Where-Object { $_ -ceq $VolumeName }
  if ($LASTEXITCODE -ne 0) { throw "Docker could not inspect the isolated QA project volumes." }
  if ($listedNames.Count -eq 0) {
    return [pscustomobject]@{ Exists = $false; IsExact = $false; Details = "" }
  }
  $inspectJson = (docker volume inspect $VolumeName 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($inspectJson)) {
    throw "Docker could not inspect QA volume $VolumeName."
  }
  try {
    $volumeMetadata = @($inspectJson | ConvertFrom-Json)[0]
    $labels = $volumeMetadata.Labels
    $details = "$($labels.'com.docker.compose.project')|$($labels.'com.docker.compose.volume')"
  } catch {
    throw "Docker returned invalid metadata for QA volume $VolumeName."
  }
  return [pscustomobject]@{
    Exists = $true
    IsExact = $details -ceq "$ProjectName|$LogicalName"
    Details = $details
  }
}

function Assert-ProjectVolumesAbsent([string]$ProjectName) {
  foreach ($entry in $qaVolumeNames.GetEnumerator()) {
    $state = Get-ProjectVolumeState $ProjectName $entry.Key $entry.Value
    if ($state.Exists) { throw "The isolated QA volume $($entry.Value) still exists." }
  }
}

function Assert-ProjectVolumesPresent([string]$ProjectName) {
  foreach ($entry in $qaVolumeNames.GetEnumerator()) {
    $state = Get-ProjectVolumeState $ProjectName $entry.Key $entry.Value
    if (-not $state.Exists) { throw "The data-preserving uninstall removed QA volume $($entry.Value)." }
    if (-not $state.IsExact) {
      throw "QA volume $($entry.Value) does not carry the expected exact Compose ownership labels."
    }
  }
}

function Get-ComposeServiceImageId([string]$InstallPath, [string]$ServiceName) {
  $environment = Join-Path $InstallPath "beta.env"
  $compose = Join-Path $InstallPath "compose.yaml"
  $containerIds = @(
    Invoke-ClearLedgerCompose --project-name $qaProjectName --env-file $environment --file $compose ps -q $ServiceName 2>$null |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  if ($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1) {
    throw "The drill could not identify exactly one $ServiceName container."
  }
  $imageId = (docker inspect --format '{{.Image}}' $containerIds[0] 2>$null | Out-String).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "The drill could not verify the $ServiceName container image ID."
  }
  return $imageId
}

function Assert-ComposeRuntimeImage([string]$InstallPath, [string]$ExpectedImageId) {
  foreach ($serviceName in @("api", "web")) {
    $actualImageId = Get-ComposeServiceImageId $InstallPath $serviceName
    if ($actualImageId -ne $ExpectedImageId) {
      throw "The $serviceName service is not running the expected runtime image $ExpectedImageId."
    }
  }
}

function Initialize-PrecedingImageInstall([string]$InstallPath) {
  $environment = Join-Path $InstallPath "beta.env"
  $compose = Join-Path $InstallPath "compose.yaml"
  if (Test-Path -LiteralPath $environment) {
    throw "The preceding-image fixture must begin without beta.env."
  }
  Assert-ProjectContainersAbsent $qaProjectName
  Assert-ProjectVolumesAbsent $qaProjectName
  $environmentLines = @(
    "CLEARLEDGER_IMAGE=$PreviousImage",
    "CLEARLEDGER_COMPOSE_PROJECT_NAME=$qaProjectName",
    "CLEARLEDGER_LOCAL_PORT=$LocalPort",
    "CLEARLEDGER_DB_PASSWORD=$(New-QaHexSecret)",
    "CLEARLEDGER_RUNTIME_DB_PASSWORD=$(New-QaHexSecret)",
    "WEBHOOK_SECRET_ENCRYPTION_SECRET=$(New-QaHexSecret)",
    "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET=$(New-QaHexSecret)",
    "PAYMENT_WEBHOOK_SECRET=$(New-QaHexSecret)",
    "PAYMENT_ACCOUNT_ENCRYPTION_SECRET=$(New-QaHexSecret)"
  )
  $temporaryEnvironment = Join-Path $InstallPath ".beta-env-preceding-$PID-$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllLines($temporaryEnvironment, $environmentLines)
    Protect-QaSecretFile $temporaryEnvironment
    [IO.File]::Move($temporaryEnvironment, $environment)
  } finally {
    if (Test-Path -LiteralPath $temporaryEnvironment -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryEnvironment -Force
    }
  }
  Set-Location -LiteralPath $InstallPath
  Invoke-ClearLedgerCompose --project-name $qaProjectName --env-file $environment --file $compose up --detach
  if ($LASTEXITCODE -ne 0) { throw "The preserved preceding runtime could not be started." }
}

function Get-Organizations([int]$Port, [string]$Email) {
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/organizations" -Headers @{
    "x-clearledger-user-email" = $Email
    "x-clearledger-user-name" = "Package lifecycle QA"
    "x-clearledger-email-verified" = "true"
  } -TimeoutSec 15
  return @($response.organizations)
}

function Remove-DisposableInitialization([string]$InstallPath) {
  $installFull = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\') + '\'
  if (-not $installFull.StartsWith($workspaceFull.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset an update extraction outside the isolated QA workspace."
  }
  $environment = Join-Path $InstallPath "beta.env"
  if (-not (Test-Path -LiteralPath $environment -PathType Leaf)) {
    throw "The disposable current-image extraction has no beta.env to reset."
  }
  Remove-Item -LiteralPath $environment -Force
}

function Expand-SafePackage([string]$Archive, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $destinationFull = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($entry in $zip.Entries) {
      if ([string]::IsNullOrEmpty($entry.FullName)) { continue }
      $target = [IO.Path]::GetFullPath((Join-Path $Destination ($entry.FullName -replace '/', '\')))
      if (-not $target.StartsWith($destinationFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The package contains an unsafe archive path: $($entry.FullName)"
      }
    }
  } finally {
    $zip.Dispose()
  }
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Get-PackageRoot([string]$Extraction) {
  $manifests = @(Get-ChildItem -LiteralPath $Extraction -Filter release-manifest.json -File -Recurse)
  if ($manifests.Count -ne 1) { throw "The package must contain exactly one release-manifest.json." }
  $root = $manifests[0].Directory.FullName
  foreach ($name in @(
    "Start-ClearLedger.ps1", "Stop-ClearLedger.ps1", "Backup-ClearLedger.ps1",
    "Restore-ClearLedger.ps1", "Update-ClearLedger.ps1", "Uninstall-ClearLedger.ps1",
    "Share-ClearLedger.ps1", "Stop-ClearLedgerShare.ps1", "compose.yaml"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $name) -PathType Leaf)) {
      throw "The extracted package is missing $name."
    }
  }
  return $root
}

function Wait-ClearLedger([int]$Port, [int]$Seconds = 300) {
  $deadline = [DateTimeOffset]::Now.AddSeconds($Seconds)
  while ([DateTimeOffset]::Now -lt $deadline) {
    try {
      $homeResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 4
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 4
      if ($homeResponse.StatusCode -eq 200 -and $health.status -eq "ok") { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "The QA installation did not become healthy within $Seconds seconds."
}

function Invoke-DemoCompany([int]$Port, [string]$Email, [string]$Key) {
  return Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$Port/api/v1/demo-company" `
    -Headers @{
      "x-clearledger-user-email" = $Email
      "x-clearledger-user-name" = "Package lifecycle QA"
      "x-clearledger-email-verified" = "true"
      "idempotency-key" = $Key
    } `
    -ContentType "application/json" `
    -Body '{"templateKey":"canadian-service"}' `
    -TimeoutSec 60
}

New-Item -ItemType Directory -Path $workspaceFull -Force | Out-Null
try {
  Add-Evidence "Artifact SHA-256 verified: $archiveHash"
  Expand-SafePackage $resolvedArchive $oldExtraction
  Expand-SafePackage $resolvedArchive $newExtraction
  $oldInstall = Get-PackageRoot $oldExtraction
  $newInstall = Get-PackageRoot $newExtraction
  $activeInstall = $oldInstall
  $manifest = Get-Content -LiteralPath (Join-Path $newInstall "release-manifest.json") -Raw | ConvertFrom-Json
  $currentImageId = ([string]$manifest.imageId).ToLowerInvariant()
  if ([string]$manifest.image -eq $PreviousImage -or $currentImageId -eq $actualPreviousImageId) {
    throw "The preceding and candidate runtime images must be distinct."
  }
  Add-Evidence "Package extracted safely; manifest version $($manifest.version)."

  Initialize-PrecedingImageInstall $oldInstall
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $oldInstall $actualPreviousImageId
  Add-Evidence "Preserved preceding image started with web/API health on loopback: $PreviousImage ($actualPreviousImageId)."

  $ownerEmail = "package-owner-$runId@example.test"
  $seed = Invoke-DemoCompany $LocalPort $ownerEmail "package-lifecycle-seed-$runId"
  $organizationId = [string]$seed.demoCompany.organizationId
  if ($organizationId -notmatch '^[0-9a-f-]{36}$') { throw "The demo-company seed did not return an organization ID." }
  Add-Evidence "Seeded one fictional company for backup/restore identity: $organizationId"

  $backupsBefore = @(Get-ChildItem -LiteralPath (Join-Path $oldInstall "Backups") -Filter "ClearLedger-Backup-*.zip" -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
  & (Join-Path $oldInstall "Backup-ClearLedger.ps1")
  $newBackups = @(Get-ChildItem -LiteralPath (Join-Path $oldInstall "Backups") -Filter "ClearLedger-Backup-*.zip" -File |
    Where-Object { $_.FullName -notin $backupsBefore } |
    Sort-Object LastWriteTime -Descending)
  if ($newBackups.Count -ne 1) {
    throw "The lifecycle backup did not produce exactly one new archive."
  }
  $backup = $newBackups[0]
  if (-not (Test-Path -LiteralPath "$($backup.FullName).sha256" -PathType Leaf)) {
    throw "The lifecycle backup checksum was not produced."
  }
  Add-Evidence "Backup produced with sibling checksum: $($backup.Name)"
  # Backup pauses the API/web services and then restarts the previously-active
  # services. Wait for the proxy and API health before issuing the next marker
  # mutation; otherwise a cold Docker Desktop restart can close the connection.
  Wait-ClearLedger $LocalPort

  $postBackupEmail = "post-backup-$runId@example.test"
  $postBackupSeed = Invoke-DemoCompany $LocalPort $postBackupEmail "package-lifecycle-mutation-$runId"
  $postBackupOrganizationId = [string]$postBackupSeed.demoCompany.organizationId
  if ($postBackupOrganizationId -notmatch '^[0-9a-f-]{36}$') {
    throw "The post-backup mutation did not return an organization ID."
  }
  & (Join-Path $oldInstall "Restore-ClearLedger.ps1") -BackupZip $backup.FullName -ConfirmRestore -SkipSafetyBackup
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $oldInstall $actualPreviousImageId
  $restoredOrganizations = @(Get-Organizations $LocalPort $ownerEmail)
  if (-not ($restoredOrganizations | Where-Object { $_.organizationId -eq $organizationId })) {
    throw "The restored backup did not recover the seeded company."
  }
  $postBackupOrganizations = @(Get-Organizations $LocalPort $postBackupEmail)
  if ($postBackupOrganizations | Where-Object { $_.organizationId -eq $postBackupOrganizationId }) {
    throw "The restored backup retained the post-backup mutation instead of replacing state."
  }
  Add-Evidence "Restore recovered the pre-backup company, removed the post-backup mutation, and returned healthy service state."

  $preUpdateEmail = "pre-update-$runId@example.test"
  $preUpdateSeed = Invoke-DemoCompany $LocalPort $preUpdateEmail "package-lifecycle-pre-update-$runId"
  $preUpdateOrganizationId = [string]$preUpdateSeed.demoCompany.organizationId
  if ($preUpdateOrganizationId -notmatch '^[0-9a-f-]{36}$') {
    throw "The pre-update recovery marker did not return an organization ID."
  }
  $updateBackupsBefore = @(
    Get-ChildItem -LiteralPath (Join-Path $oldInstall "Backups") -Filter "ClearLedger-Backup-*.zip" -File -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
  )
  & (Join-Path $newInstall "Update-ClearLedger.ps1") -PreviousInstallPath $oldInstall -AcceptLicense -NoBrowser
  $activeInstall = $newInstall
  $newUpdateBackups = @(Get-ChildItem -LiteralPath (Join-Path $oldInstall "Backups") -Filter "ClearLedger-Backup-*.zip" -File |
    Where-Object { $_.FullName -notin $updateBackupsBefore } |
    Sort-Object LastWriteTime -Descending)
  if ($newUpdateBackups.Count -ne 1) {
    throw "The preceding-to-current update did not produce exactly one pre-update recovery point."
  }
  $preUpdateBackup = $newUpdateBackups[0]
  if (-not (Test-Path -LiteralPath "$($preUpdateBackup.FullName).sha256" -PathType Leaf)) {
    throw "The preceding-to-current update did not leave its verified pre-update recovery point."
  }
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $newInstall $currentImageId
  Add-Evidence "Preceding-to-current update reached the candidate image and preserved a verified pre-update backup."

  Set-Location -LiteralPath $newInstall
  Invoke-ClearLedgerCompose --project-name $qaProjectName --env-file (Join-Path $newInstall "beta.env") --file (Join-Path $newInstall "compose.yaml") restart api web *> $null
  if ($LASTEXITCODE -ne 0) { throw "Current-image restart failed." }
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $newInstall $currentImageId
  Add-Evidence "Current-image API/web restart recovered within the bounded wait."

  $postUpdateEmail = "post-update-$runId@example.test"
  $postUpdateSeed = Invoke-DemoCompany $LocalPort $postUpdateEmail "package-lifecycle-post-update-$runId"
  $postUpdateOrganizationId = [string]$postUpdateSeed.demoCompany.organizationId
  if ($postUpdateOrganizationId -notmatch '^[0-9a-f-]{36}$') {
    throw "The post-update rollback marker did not return an organization ID."
  }

  # The previous image is never restarted against the forward-migrated database.
  # Its restore script first stops the candidate services and replaces the database
  # with the verified pre-update backup; only then does it start the previous image.
  & (Join-Path $oldInstall "Restore-ClearLedger.ps1") `
    -BackupZip $preUpdateBackup.FullName `
    -ConfirmRestore `
    -SkipSafetyBackup
  $activeInstall = $oldInstall
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $oldInstall $actualPreviousImageId
  $preUpdateOrganizations = @(Get-Organizations $LocalPort $preUpdateEmail)
  if (-not ($preUpdateOrganizations | Where-Object { $_.organizationId -eq $preUpdateOrganizationId })) {
    throw "Rollback did not recover the pre-update marker company."
  }
  $postUpdateOrganizations = @(Get-Organizations $LocalPort $postUpdateEmail)
  if ($postUpdateOrganizations | Where-Object { $_.organizationId -eq $postUpdateOrganizationId }) {
    throw "Rollback retained the post-update mutation instead of restoring the pre-update state."
  }
  Add-Evidence "Verified rollback restored pre-update state, removed post-update state, and started only the preceding image after database replacement."

  # Reuse the exact verified candidate extraction only after rollback. Removing its
  # disposable beta.env resets the update marker; all authoritative data and secrets
  # remain in the rolled-back old installation and its verified recovery backup.
  Remove-DisposableInitialization $newInstall
  & (Join-Path $newInstall "Update-ClearLedger.ps1") -PreviousInstallPath $oldInstall -AcceptLicense -NoBrowser
  $activeInstall = $newInstall
  Wait-ClearLedger $LocalPort
  Assert-ComposeRuntimeImage $newInstall $currentImageId
  $resumedOrganizations = @(Get-Organizations $LocalPort $preUpdateEmail)
  if (-not ($resumedOrganizations | Where-Object { $_.organizationId -eq $preUpdateOrganizationId })) {
    throw "The final re-update did not preserve the rolled-back recovery marker."
  }
  Add-Evidence "Candidate re-update after verified rollback completed with preserved pre-update state."

  $sharePassword = ([Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")).Substring(0, 32)
  $shareScript = Join-Path $newInstall "Share-ClearLedger.ps1"
  $shareJob = Start-Job -ScriptBlock {
    param($Script, $Email, $Organization, $Subdomain, $Port, $Password)
      & $Script -Email $Email -OrganizationId $Organization -Subdomain $Subdomain `
      -SharePort $Port -Username "qaviewer" -Password $Password
  } -ArgumentList $shareScript, $ownerEmail, $organizationId, $ShareSubdomain, $SharePort, $sharePassword

  $statePath = Join-Path $newInstall ".share-state.json"
  $stateDeadline = [DateTimeOffset]::Now.AddSeconds(180)
  while (-not (Test-Path -LiteralPath $statePath -PathType Leaf) -and
      [DateTimeOffset]::Now -lt $stateDeadline -and $shareJob.State -eq "Running") {
    Start-Sleep -Seconds 2
  }
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    $shareFailureOutput = @(Receive-Job -Job $shareJob -ErrorAction SilentlyContinue)
    $shareFailureText = ($shareFailureOutput | ForEach-Object { $_.ToString() }) -join " "
    if ([string]::IsNullOrWhiteSpace($shareFailureText)) { $shareFailureText = "no child output" }
    throw "The package-owned Loclx share state was not created within three minutes. Child status=$($shareJob.State); output=$shareFailureText"
  }
  $authorization = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("qaviewer:$sharePassword"))
  $publicDeadline = [DateTimeOffset]::Now.AddSeconds(90)
  $publicReady = $false
  while ([DateTimeOffset]::Now -lt $publicDeadline) {
    try {
      $public = Invoke-WebRequest -UseBasicParsing -Uri "https://$ShareSubdomain.loclx.io" `
        -Headers @{ Authorization = "Basic $authorization" } -TimeoutSec 6
      if ($public.StatusCode -eq 200) { $publicReady = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
  }
  if (-not $publicReady) { throw "The authenticated HTTPS share did not become reachable." }
  & (Join-Path $newInstall "Stop-ClearLedgerShare.ps1")
  Wait-Job -Job $shareJob -Timeout 30 | Out-Null
  $shareOutput = @(Receive-Job -Job $shareJob -ErrorAction SilentlyContinue)
  if ($shareJob.State -ne "Completed") {
    throw "Share-ClearLedger did not exit cleanly after the external stop. $($shareOutput -join ' ')"
  }
  Remove-Job -Job $shareJob -Force
  $shareJob = $null
  if (Test-Path -LiteralPath $statePath) { throw "The package share state survived the stop." }
  foreach ($priorId in $priorLoclxIds) {
    if (-not (Get-Process -Id $priorId -ErrorAction SilentlyContinue)) {
      throw "An unrelated pre-existing Loclx process was stopped by the drill."
    }
  }
  Add-Evidence "Authenticated share start/external-stop completed; package state cleared and prior Loclx processes survived."

  & (Join-Path $newInstall "Uninstall-ClearLedger.ps1")
  Assert-ProjectContainersAbsent $qaProjectName
  Assert-ProjectVolumesPresent $qaProjectName
  Add-Evidence "Packaged uninstall removed services and preserved both exact project data volumes."

  Set-Location -LiteralPath $newInstall
  Invoke-ClearLedgerCompose --project-name $qaProjectName --env-file (Join-Path $newInstall "beta.env") --file (Join-Path $newInstall "compose.yaml") down --volumes --remove-orphans *> $null
  if ($LASTEXITCODE -ne 0) { throw "The exact isolated QA volumes could not be removed after the uninstall assertion." }
  Assert-ProjectContainersAbsent $qaProjectName
  Assert-ProjectVolumesAbsent $qaProjectName
  Add-Evidence "Exact QA project data cleanup completed without broad container or tunnel matching."
  $succeeded = $true
} catch {
  $caughtFailure = $_
  $succeeded = $false
  Add-Evidence "FAIL: $($_.Exception.Message)"
} finally {
  if ($shareJob) {
    try {
      if ($activeInstall -and (Test-Path -LiteralPath (Join-Path $activeInstall "Stop-ClearLedgerShare.ps1"))) {
        & (Join-Path $activeInstall "Stop-ClearLedgerShare.ps1") -Quiet
      }
    } catch {
      $cleanupFailures.Add("The package-owned share could not be stopped: $($_.Exception.Message)")
    }
    try { Stop-Job -Job $shareJob -ErrorAction Stop } catch {
      $cleanupFailures.Add("The lifecycle share job could not be stopped: $($_.Exception.Message)")
    }
    try { Remove-Job -Job $shareJob -Force -ErrorAction Stop } catch {
      $cleanupFailures.Add("The lifecycle share job could not be removed: $($_.Exception.Message)")
    }
  }

  try {
    $remainingContainers = @(Get-ProjectContainerIds $qaProjectName)
    $remainingVolumes = @(
      foreach ($entry in $qaVolumeNames.GetEnumerator()) {
        $state = Get-ProjectVolumeState $qaProjectName $entry.Key $entry.Value
        if ($state.Exists) { $entry.Value }
      }
    )
    if ($remainingContainers.Count -gt 0 -or $remainingVolumes.Count -gt 0) {
      if (-not $activeInstall -or
          -not (Test-Path -LiteralPath (Join-Path $activeInstall "compose.yaml") -PathType Leaf) -or
          -not (Test-Path -LiteralPath (Join-Path $activeInstall "beta.env") -PathType Leaf)) {
        throw "Exact QA resources remain, but no intact active extraction is available for scoped cleanup."
      }
      $qaEnvironment = Join-Path $activeInstall "beta.env"
      $qaCompose = Join-Path $activeInstall "compose.yaml"
      try {
        Set-Location -LiteralPath $activeInstall
        Invoke-ClearLedgerCompose --project-name $qaProjectName --env-file $qaEnvironment --file $qaCompose down --volumes --remove-orphans *> $null
        if ($LASTEXITCODE -ne 0) {
          throw "Docker Compose returned exit code $LASTEXITCODE."
        }
      } catch {
        throw "Exact-project Docker cleanup failed: $($_.Exception.Message)"
      }
    }
    Assert-ProjectContainersAbsent $qaProjectName
    Assert-ProjectVolumesAbsent $qaProjectName
  } catch {
    $cleanupFailures.Add($_.Exception.Message)
  }
  if ($cleanupFailures.Count -gt 0) {
    $cleanupSucceeded = $false
    $succeeded = $false
    foreach ($cleanupFailure in $cleanupFailures) {
      Add-Evidence "CLEANUP FAIL: $cleanupFailure"
    }
    Add-Evidence "The QA workspace was preserved for exact-target recovery: $workspaceFull"
  }

  if ($cleanupSucceeded -and ($succeeded -or -not $KeepWorkspaceOnFailure)) {
    $resolvedWorkspace = [IO.Path]::GetFullPath($workspaceFull)
    if ($resolvedWorkspace.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedWorkspace) -eq "ClearLedgerPublicBetaQa-$runId" -and
        (Test-Path -LiteralPath $resolvedWorkspace)) {
      try {
        Set-Location -LiteralPath $temporaryBase
        Remove-Item -LiteralPath $resolvedWorkspace -Recurse -Force
      } catch {
        $cleanupSucceeded = $false
        $succeeded = $false
        $cleanupFailures.Add("The verified disposable workspace could not be removed: $($_.Exception.Message)")
        Add-Evidence "CLEANUP FAIL: $($cleanupFailures[$cleanupFailures.Count - 1])"
        Add-Evidence "The remaining QA workspace was preserved for recovery: $workspaceFull"
      }
    }
  }

  $reportParent = Split-Path -Parent $reportFull
  if (-not (Test-Path -LiteralPath $reportParent)) { New-Item -ItemType Directory -Path $reportParent -Force | Out-Null }
  $report = @(
    "ClearLedger final package lifecycle drill",
    "Result: $(if ($succeeded -and $cleanupSucceeded) { 'PASS' } else { 'FAIL' })",
    "Package: $([IO.Path]::GetFileName($resolvedArchive))",
    "Package SHA-256: $archiveHash",
    "Candidate image: $([string]$manifest.image) ($currentImageId)",
    "Preceding image: $PreviousImage ($actualPreviousImageId)",
    "Isolated Compose project: $qaProjectName",
    "Generated: $([DateTimeOffset]::Now.ToString('u'))",
    ""
  ) + $evidence.ToArray()
  [IO.File]::WriteAllLines($reportFull, $report)
}

if ($cleanupFailures.Count -gt 0) {
  $failurePrefix = if ($caughtFailure) { "Lifecycle failed: $($caughtFailure.Exception.Message) " } else { "" }
  throw "${failurePrefix}Exact-target cleanup also failed; workspace preserved at $workspaceFull. $($cleanupFailures -join ' | ')"
}
if ($caughtFailure) { throw $caughtFailure }
Write-Output ($evidence.ToArray() -join "`n")
