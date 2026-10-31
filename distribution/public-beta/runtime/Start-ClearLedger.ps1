[CmdletBinding()]
param(
  [switch]$AcceptLicense,
  [switch]$NoBrowser,
  [ValidateRange(1024, 65535)]
  [int]$LocalPort = 3000,
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{0,62}$')]
  [string]$ComposeProjectName = "clearledger-beta"
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$licenseAcceptancePath = Join-Path $runtimeDirectory ".license-accepted"
$imageArchivePath = Join-Path $runtimeDirectory "clearledger-public-beta-image.tar"
$releaseManifestPath = Join-Path $runtimeDirectory "release-manifest.json"
$checksumPath = Join-Path $runtimeDirectory "SHA256SUMS.txt"
$postgresImage = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
$prerequisiteScriptPath = Join-Path $runtimeDirectory "Test-ClearLedgerPrerequisites.ps1"

Set-Location -LiteralPath $runtimeDirectory

if (Test-Path -LiteralPath $prerequisiteScriptPath -PathType Leaf) {
  & $prerequisiteScriptPath -MinimumFreeSpaceGB 10
  if ($LASTEXITCODE -ne 0) {
    throw "ClearLedger prerequisites are incomplete. Run Test-ClearLedgerPrerequisites.ps1 for details."
  }
}

if ($env:OS -ne "Windows_NT" -or -not [Environment]::Is64BitOperatingSystem) {
  throw "This beta package requires a supported 64-bit Windows host."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker is required. Install a supported Docker Engine or Docker Desktop, start it, and run this script again."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker is installed but its engine is not running. Start Docker and run this script again."
}
Get-ClearLedgerComposeExecutable | Out-Null

foreach ($requiredPackageFile in @($releaseManifestPath, $checksumPath, $imageArchivePath)) {
  if (-not (Test-Path -LiteralPath $requiredPackageFile -PathType Leaf)) {
    throw "This is not a complete ClearLedger public-beta package. Missing $([IO.Path]::GetFileName($requiredPackageFile))."
  }
}
$releaseManifest = Get-Content -LiteralPath $releaseManifestPath -Raw | ConvertFrom-Json
$releaseVersion = [string]$releaseManifest.version
$imageName = [string]$releaseManifest.image
if ($releaseManifest.product -ne "ClearLedger Public Beta" -or
    $releaseVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$' -or
    $imageName -ne "clearledger/public-beta:$releaseVersion" -or
    $releaseManifest.postgresImage -ne $postgresImage -or
    $releaseManifest.verificationSkipped -ne $false -or
    $releaseManifest.evidenceState -ne "verified-package-assembly" -or
    $releaseManifest.artifactName -ne "ClearLedger-Public-Beta-$releaseVersion.zip" -or
    $releaseManifest.archiveFormat -ne "zip-with-docker-image-v1" -or
    $releaseManifest.sourceReduced -ne $true -or
    $releaseManifest.localBinding -ne "127.0.0.1:3000" -or
    $releaseManifest.localPortConfigurable -ne $true -or
    ([string]$releaseManifest.imageId) -notmatch '^sha256:[a-f0-9]{64}$' -or
    ([string]$releaseManifest.imageArchiveSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$releaseManifest.sbomSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$releaseManifest.sourceInputSha256) -notmatch '^[a-f0-9]{64}$' -or
    ([string]$releaseManifest.migrationSetSha256) -notmatch '^[a-f0-9]{64}$' -or
    [int]$releaseManifest.sourceInputFileCount -lt 1 -or
    [int]$releaseManifest.migrationCount -lt 1) {
  throw "The release manifest is invalid or identifies an unverified package. Re-download the official verified beta."
}

$installDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($runtimeDirectory).TrimEnd('\').TrimEnd(':'))
if ($null -eq $installDrive -or $installDrive.Free -lt 10GB) {
  throw "At least 10 GB of free space is required on the ClearLedger installation drive."
}

$environmentExistedAtStart = Test-Path -LiteralPath $environmentPath -PathType Leaf
if (-not $environmentExistedAtStart) {
  $freshPortListener = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue
  if ($freshPortListener) {
    $ownerIds = ($freshPortListener | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "Local port $LocalPort is already used by another program (process $ownerIds). Initialize this fresh extraction with another -LocalPort value."
  }
}

if (-not (Test-Path -LiteralPath $licenseAcceptancePath)) {
  if (-not $AcceptLicense) {
    Write-Host "Read BETA_LICENSE.txt and KNOWN_LIMITATIONS.md before continuing."
    $answer = Read-Host "Type ACCEPT to accept the public-beta licence"
    if ($answer -cne "ACCEPT") {
      throw "Licence not accepted. ClearLedger was not started."
    }
  }
  [System.IO.File]::WriteAllText(
    $licenseAcceptancePath,
    "Accepted $([DateTimeOffset]::Now.ToString('o'))`r`n"
  )
}

function New-HexSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Protect-ClearLedgerSecretFile([string]$Path) {
  if ($env:OS -ne "Windows_NT") { throw "This public-beta installer supports Windows only." }
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

function Read-ClearLedgerEnvironmentFile([string]$Path) {
  $values = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') {
      throw "The ClearLedger environment file is malformed. Restore beta.env from a protected backup."
    }
    $name = $Matches[1]
    if ($values.ContainsKey($name)) {
      throw "The ClearLedger environment file contains a duplicate $name entry."
    }
    $values[$name] = $Matches[2]
  }
  return $values
}

if (-not (Test-Path -LiteralPath $environmentPath)) {
  Write-Host "Creating protected installation secrets for this extraction..."
  $projectResourceNames = @(
    "${ComposeProjectName}_clearledger_database",
    "${ComposeProjectName}_clearledger_files"
  )
  $existingResources = @()
  foreach ($resourceName in $projectResourceNames) {
    docker volume inspect $resourceName *> $null
    if ($LASTEXITCODE -eq 0) { $existingResources += $resourceName }
  }
  $existingContainers = @(
    docker ps --all --quiet --filter "label=com.docker.compose.project=$ComposeProjectName" 2>$null
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($existingResources.Count -gt 0 -or $existingContainers.Count -gt 0) {
    throw "Existing ClearLedger beta data or containers were found, but this folder has no beta.env. Use the original installation folder or Update-ClearLedger.ps1; refusing to attach new secrets to existing data."
  }
  $environmentLines = @(
    "CLEARLEDGER_IMAGE=$imageName",
    "CLEARLEDGER_COMPOSE_PROJECT_NAME=$ComposeProjectName",
    "CLEARLEDGER_LOCAL_PORT=$LocalPort",
    "CLEARLEDGER_DB_PASSWORD=$(New-HexSecret)",
    "CLEARLEDGER_RUNTIME_DB_PASSWORD=$(New-HexSecret)",
    "WEBHOOK_SECRET_ENCRYPTION_SECRET=$(New-HexSecret)",
    "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET=$(New-HexSecret)",
    "PAYMENT_WEBHOOK_SECRET=$(New-HexSecret)",
    "PAYMENT_ACCOUNT_ENCRYPTION_SECRET=$(New-HexSecret)"
  )
  $temporaryEnvironmentPath = Join-Path $runtimeDirectory ".beta-env-$PID-$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllLines($temporaryEnvironmentPath, $environmentLines)
    Protect-ClearLedgerSecretFile $temporaryEnvironmentPath
    [System.IO.File]::Move($temporaryEnvironmentPath, $environmentPath)
  } finally {
    if (Test-Path -LiteralPath $temporaryEnvironmentPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryEnvironmentPath -Force
    }
  }
}

$environmentValues = Read-ClearLedgerEnvironmentFile $environmentPath
$requiredEnvironmentNames = @(
  "CLEARLEDGER_IMAGE",
  "CLEARLEDGER_DB_PASSWORD",
  "CLEARLEDGER_RUNTIME_DB_PASSWORD",
  "WEBHOOK_SECRET_ENCRYPTION_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_ACCOUNT_ENCRYPTION_SECRET"
)
$allowedEnvironmentNames = @(
  $requiredEnvironmentNames
  "CLEARLEDGER_COMPOSE_PROJECT_NAME"
  "CLEARLEDGER_LOCAL_PORT"
)
if ($environmentValues.Count -lt $requiredEnvironmentNames.Count -or
    $environmentValues.Count -gt $allowedEnvironmentNames.Count) {
  throw "The ClearLedger environment file contains missing or unexpected entries."
}
foreach ($environmentName in $environmentValues.Keys) {
  if ($environmentName -notin $allowedEnvironmentNames) {
    throw "The ClearLedger environment file contains an unexpected $environmentName entry."
  }
}
foreach ($requiredName in $requiredEnvironmentNames) {
  if (-not $environmentValues.ContainsKey($requiredName)) {
    throw "The ClearLedger environment file is missing $requiredName."
  }
}
if ([string]$environmentValues["CLEARLEDGER_IMAGE"] -ne $imageName) {
  throw "beta.env selects a different ClearLedger runtime image. Use Update-ClearLedger.ps1 for version changes."
}
$composeProjectName = if ($environmentValues.ContainsKey("CLEARLEDGER_COMPOSE_PROJECT_NAME")) {
  [string]$environmentValues["CLEARLEDGER_COMPOSE_PROJECT_NAME"]
} else {
  "clearledger-beta"
}
if ($composeProjectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
  throw "CLEARLEDGER_COMPOSE_PROJECT_NAME is invalid. Restore beta.env from a protected backup."
}
if ($PSBoundParameters.ContainsKey("ComposeProjectName") -and $ComposeProjectName -ne $composeProjectName) {
  throw "This initialized ClearLedger installation uses Compose project $composeProjectName. Omit -ComposeProjectName or use that exact value."
}
foreach ($secretName in $requiredEnvironmentNames | Where-Object { $_ -ne "CLEARLEDGER_IMAGE" }) {
  if ([string]$environmentValues[$secretName] -notmatch '^[a-f0-9]{64}$') {
    throw "The $secretName value is invalid. Restore beta.env from a protected backup."
  }
}
$storedLocalPort = 3000
if ($environmentValues.ContainsKey("CLEARLEDGER_LOCAL_PORT")) {
  $parsedLocalPort = 0
  if (-not [int]::TryParse([string]$environmentValues["CLEARLEDGER_LOCAL_PORT"], [ref]$parsedLocalPort) -or
      $parsedLocalPort -lt 1024 -or
      $parsedLocalPort -gt 65535) {
    throw "CLEARLEDGER_LOCAL_PORT must be a port from 1024 through 65535."
  }
  $storedLocalPort = $parsedLocalPort
}
if ($PSBoundParameters.ContainsKey("LocalPort") -and $LocalPort -ne $storedLocalPort) {
  throw "This initialized ClearLedger installation uses local port $storedLocalPort. Omit -LocalPort or use that same value; updates preserve the installed port."
}
$effectiveLocalPort = $storedLocalPort
# A freshly generated beta.env is protected before it is moved into place. On
# subsequent starts, do not rewrite the existing descriptor: Set-Acl attempts to
# replace the inherited SACL on some Windows hosts and can require SeSecurityPrivilege.
if (-not $environmentExistedAtStart) {
  Protect-ClearLedgerSecretFile $environmentPath
}
$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath
)

$existingWebContainerOutput = Invoke-ClearLedgerCompose @composeArguments ps -q web 2>$null | Out-String
if ($LASTEXITCODE -ne 0) { throw "The initialized ClearLedger compose configuration is invalid." }
$existingWebContainer = $existingWebContainerOutput.Trim()
$portListener = Get-NetTCPConnection -State Listen -LocalPort $effectiveLocalPort -ErrorAction SilentlyContinue
if ($portListener -and -not $existingWebContainer) {
  $ownerIds = ($portListener | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
  throw "Local port $effectiveLocalPort is already used by another program (process $ownerIds). On a fresh extraction, choose another port with -LocalPort."
}

$archiveChecksumLines = @(
  Get-Content -LiteralPath $checksumPath |
    Where-Object { $_ -match '^[a-fA-F0-9]{64}\s{2}clearledger-public-beta-image\.tar$' }
)
if ($archiveChecksumLines.Count -ne 1) {
  throw "The package checksum inventory does not identify exactly one runtime image archive."
}
$expectedArchiveHash = (($archiveChecksumLines[0] -split '\s+')[0]).ToLowerInvariant()
if ($expectedArchiveHash -ne ([string]$releaseManifest.imageArchiveSha256).ToLowerInvariant()) {
  throw "The manifest and checksum inventory disagree about the runtime image."
}

$expectedImageId = ([string]$releaseManifest.imageId).ToLowerInvariant()
$installedImageId = ""
docker image inspect $imageName *> $null
if ($LASTEXITCODE -eq 0) {
  $installedImageId = (docker image inspect --format '{{.Id}}' $imageName | Out-String).Trim().ToLowerInvariant()
}
$runtimeImageAvailable = $installedImageId -eq $expectedImageId
docker image inspect $postgresImage *> $null
if ($LASTEXITCODE -ne 0) { $runtimeImageAvailable = $false }
if (-not $runtimeImageAvailable) {
  $actualArchiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $imageArchivePath).Hash.ToLowerInvariant()
  if ($actualArchiveHash -ne $expectedArchiveHash) {
    throw "The bundled runtime image failed its SHA-256 integrity check. Re-download the official verified beta."
  }
  Write-Host "Loading the verified ClearLedger runtime. This can take a few minutes..."
  docker load --input $imageArchivePath
  if ($LASTEXITCODE -ne 0) { throw "Docker could not load the ClearLedger runtime image." }
  $loadedImageId = (docker image inspect --format '{{.Id}}' $imageName 2>$null | Out-String).Trim().ToLowerInvariant()
  if ($loadedImageId -ne $expectedImageId) {
    throw "The loaded ClearLedger runtime does not match the verified release manifest."
  }
  docker image inspect $postgresImage *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "The bundled PostgreSQL runtime does not match the pinned release reference."
  }
}

Write-Host "Starting the private database and ClearLedger services..."
Invoke-ClearLedgerCompose @composeArguments up --detach
if ($LASTEXITCODE -ne 0) { throw "ClearLedger did not start. Run Diagnose-ClearLedger.ps1." }

Write-Host "Waiting up to two minutes for the ClearLedger web application and API..."
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
  Invoke-ClearLedgerCompose @composeArguments ps
  throw "ClearLedger did not become ready within two minutes. Run Diagnose-ClearLedger.ps1."
}

Write-Host "ClearLedger is ready at http://localhost:$effectiveLocalPort"
Write-Host "Data remains on this computer. Run Backup-ClearLedger.ps1 before relying on real records."
if (-not $NoBrowser) { Start-Process "http://localhost:$effectiveLocalPort" }
