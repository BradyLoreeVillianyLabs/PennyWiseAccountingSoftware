[CmdletBinding()]
param(
  [switch]$SkipVerification
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$package = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$package.version
$imageName = "clearledger/public-beta:$version"
$postgresImage = "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193"
$distributionRoot = Join-Path $repositoryRoot "distribution\public-beta"
$outputRoot = Join-Path $distributionRoot "output"
$artifactSuffix = if ($SkipVerification) { "-UNVERIFIED-DO-NOT-DISTRIBUTE" } else { "" }
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) "clearledger-public-beta-staging"
# Use a process-scoped staging directory outside the distribution tree so a locked or
# partially-removed Windows output directory can never contaminate the next assembly. The
# public artifact name remains stable; only this transient directory is unique.
$stageDirectory = Join-Path $stageRoot ".staging-ClearLedger-Public-Beta-$version-$PID$artifactSuffix"
$runtimeSource = Join-Path $distributionRoot "runtime"
$dockerfile = Join-Path $distributionRoot "docker\Dockerfile.beta"
$archivePath = Join-Path $outputRoot "ClearLedger-Public-Beta-$version$artifactSuffix.zip"
$artifactName = [IO.Path]::GetFileName($archivePath)
$archiveChecksumPath = "$archivePath.sha256"
$temporaryArchivePath = Join-Path $outputRoot ".$artifactName.$PID.tmp"
$temporaryChecksumPath = "$temporaryArchivePath.sha256.tmp"
$msiPath = Join-Path $outputRoot "ClearLedger-Public-Beta-$version-x64.msi"
$msiChecksumPath = "$msiPath.sha256"
$evidenceState = if ($SkipVerification) {
  "unverified-development-artifact"
} else {
  "verified-package-assembly"
}

function Get-ClearLedgerRelativePath([string]$BasePath, [string]$TargetPath) {
  $baseFullPath = [IO.Path]::GetFullPath($BasePath).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  $targetFullPath = [IO.Path]::GetFullPath($TargetPath)
  if (-not $targetFullPath.StartsWith($baseFullPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to calculate a package path outside $baseFullPath"
  }
  return $targetFullPath.Substring($baseFullPath.Length).Replace('\', '/')
}

function Get-ClearLedgerFingerprint([System.IO.FileInfo[]]$Files) {
  $lines = $Files |
    Sort-Object FullName |
    ForEach-Object {
      $relative = Get-ClearLedgerRelativePath $repositoryRoot $_.FullName
      "$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $relative"
    }
  $canonical = if ($lines.Count -gt 0) { ($lines -join "`n") + "`n" } else { "" }
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
    return ([System.BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $hasher.Dispose()
  }
}

function Get-ClearLedgerGateInputFiles([string[]]$InputPaths) {
  $files = foreach ($inputPath in $InputPaths) {
    $resolvedInput = Join-Path $repositoryRoot $inputPath
    if (Test-Path -LiteralPath $resolvedInput -PathType Container) {
      Get-ChildItem -LiteralPath $resolvedInput -Recurse -File -ErrorAction SilentlyContinue
    } elseif (Test-Path -LiteralPath $resolvedInput -PathType Leaf) {
      Get-Item -LiteralPath $resolvedInput
    } else {
      throw "A required release-gate input is missing: $inputPath"
    }
  }
  return @($files |
    Where-Object {
      $relative = Get-ClearLedgerRelativePath $repositoryRoot $_.FullName
      $relative -notmatch '(^|/)(?:node_modules|dist|build|coverage|test-results|playwright-report|generated|tmp-prisma-client|output|\.data)(?:/|$)' -and
        $relative -notmatch '^distribution/public-beta/qa/.*\.log$'
    } |
    Sort-Object FullName -Unique)
}

Set-Location -LiteralPath $repositoryRoot
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$resolvedOutput = [IO.Path]::GetFullPath($outputRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
$resolvedStageRoot = [IO.Path]::GetFullPath($stageRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
if (Test-Path -LiteralPath $stageDirectory) {
  $resolvedStage = [IO.Path]::GetFullPath($stageDirectory)
  if (-not $resolvedStage.StartsWith($resolvedStageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a staging directory outside the temporary release root."
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
$generatedFiles = @($archivePath, $archiveChecksumPath, $temporaryArchivePath, $temporaryChecksumPath)
if (-not $SkipVerification) { $generatedFiles += @($msiPath, $msiChecksumPath) }
foreach ($generatedFile in $generatedFiles) {
  $resolvedGeneratedFile = [IO.Path]::GetFullPath($generatedFile)
  if (-not $resolvedGeneratedFile.StartsWith($resolvedOutput, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a generated artifact outside distribution/public-beta/output."
  }
  if (Test-Path -LiteralPath $resolvedGeneratedFile) {
    Remove-Item -LiteralPath $resolvedGeneratedFile -Force
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required to build the beta runtime." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Start the Docker engine before building the beta." }

$gateInputPaths = @(
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.eslint.json",
  "eslint.config.js",
  ".prettierignore",
  ".prettierrc.json",
  "playwright.config.mjs",
  "apps\api",
  "apps\web",
  "packages\accounting-core",
  "packages\db",
  "packages\shared",
  "scripts",
  "docs",
  "distribution\public-beta",
  "CHANGELOG.md"
)
$gateInputFiles = @(Get-ClearLedgerGateInputFiles $gateInputPaths)
if ($gateInputFiles.Count -lt 1) { throw "No release-gate inputs were found." }
$gateInputSha256 = Get-ClearLedgerFingerprint $gateInputFiles

if (-not $SkipVerification) {
  Write-Host "Running the complete ClearLedger engineering gate..."
  & corepack pnpm check
  if ($LASTEXITCODE -ne 0) { throw "The engineering gate failed; no beta was built." }
  & corepack pnpm test:release
  if ($LASTEXITCODE -ne 0) { throw "The release contract gate failed; no beta was built." }
  & corepack pnpm test:e2e
  if ($LASTEXITCODE -ne 0) { throw "The browser workflow gate failed; no beta was built." }
  & corepack pnpm test:performance
  if ($LASTEXITCODE -ne 0) { throw "The database performance gate failed; no beta was built." }
  & corepack pnpm test:security
  if ($LASTEXITCODE -ne 0) { throw "The security contract gate failed; no beta was built." }
  & corepack pnpm audit --prod --audit-level high
  if ($LASTEXITCODE -ne 0) { throw "The production dependency audit failed; no beta was built." }
}

New-Item -ItemType Directory -Path $stageDirectory | Out-Null

$createdAt = [DateTimeOffset]::UtcNow
$created = $createdAt.ToString("o")
$sourceInputPaths = @(
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "apps\api\package.json",
  "apps\api\tsconfig.json",
  "apps\api\src",
  "apps\web\package.json",
  "apps\web\index.html",
  "apps\web\app.js",
  "apps\web\money.js",
  "apps\web\pwa.js",
  "apps\web\styles.css",
  "apps\web\serve.mjs",
  "apps\web\service-worker.js",
  "apps\web\manifest.webmanifest",
  "apps\web\offline.html",
  "apps\web\icons",
  "apps\web\scripts",
  "packages\accounting-core\package.json",
  "packages\accounting-core\tsconfig.json",
  "packages\accounting-core\src",
  "packages\db\package.json",
  "packages\db\tsconfig.json",
  "packages\db\src",
  "packages\db\prisma",
  "packages\shared\package.json",
  "packages\shared\tsconfig.json",
  "packages\shared\src",
  "distribution\public-beta\docker\Dockerfile.beta",
  "distribution\public-beta\docker\Dockerfile.beta.dockerignore"
)
$sourceInputFiles = foreach ($inputPath in $sourceInputPaths) {
  $resolvedInput = Join-Path $repositoryRoot $inputPath
  if (Test-Path -LiteralPath $resolvedInput -PathType Container) {
    Get-ChildItem -LiteralPath $resolvedInput -Recurse -File
  } elseif (Test-Path -LiteralPath $resolvedInput -PathType Leaf) {
    Get-Item -LiteralPath $resolvedInput
  } else {
    throw "A required runtime build input is missing: $inputPath"
  }
}
$sourceInputFiles = @($sourceInputFiles | Sort-Object FullName -Unique)
$sourceInputSha256 = Get-ClearLedgerFingerprint $sourceInputFiles
$migrationFiles = @(
  Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "packages\db\prisma\migrations") -Recurse -File
)
$migrationSetSha256 = Get-ClearLedgerFingerprint $migrationFiles
$migrationCount = @(
  Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "packages\db\prisma\migrations") -Directory
).Count
Write-Host "Building the source-reduced ClearLedger image..."
docker build --file $dockerfile --tag $imageName --build-arg "CLEARLEDGER_VERSION=$version" --build-arg "CLEARLEDGER_CREATED=$created" $repositoryRoot
if ($LASTEXITCODE -ne 0) { throw "The source-reduced runtime image failed to build." }

$sourceLeakCommand = @'
set -eu
find /app -path /app/node_modules -prune -o -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name '.tsbuildinfo' -o -name '*.test.js' -o -name '*.integration.js' -o -name '*.spec.js' -o -name 'test-utils.js' \) -print
for package_name in accounting-core db shared; do
  package_path=$(readlink -f "/app/node_modules/@clearledger/$package_name")
  find "$package_path" -path "$package_path/generated-client" -prune -o -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.map' -o -name '.tsbuildinfo' -o -name '*.test.js' -o -name '*.integration.js' -o -name '*.spec.js' -o -name 'test-utils.js' \) -print
done
'@
$sourceLeak = docker run --rm --entrypoint sh $imageName -c $sourceLeakCommand
if ($LASTEXITCODE -ne 0) { throw "The runtime source-reduction inspection failed." }
if (($sourceLeak | Out-String).Trim()) {
  throw "The runtime still contains ClearLedger source, test, or compiler artifacts:`n$($sourceLeak | Out-String)"
}

$runtimePackageFiles = @(
  "Backup-ClearLedger.ps1",
  "Compose-Compatibility.ps1",
  "compose.share.yaml",
  "compose.yaml",
  "Diagnose-ClearLedger.ps1",
  "INSTALL_WINDOWS.md",
  "Restore-ClearLedger.ps1",
  "Share-ClearLedger.ps1",
  "Start-ClearLedger.ps1",
  "Test-ClearLedgerPrerequisites.ps1",
  "Stop-ClearLedger.ps1",
  "Stop-ClearLedgerShare.ps1",
  "Uninstall-ClearLedger.ps1",
  "Update-ClearLedger.ps1"
)
foreach ($runtimeFile in $runtimePackageFiles) {
  $runtimeFilePath = Join-Path $runtimeSource $runtimeFile
  if (-not (Test-Path -LiteralPath $runtimeFilePath -PathType Leaf)) {
    throw "A required public-beta runtime file is missing: $runtimeFile"
  }
  Copy-Item -LiteralPath $runtimeFilePath -Destination $stageDirectory
}
Copy-Item -LiteralPath (Join-Path $distributionRoot "BETA_LICENSE.txt") -Destination $stageDirectory
Copy-Item -LiteralPath (Join-Path $distributionRoot "KNOWN_LIMITATIONS.md") -Destination $stageDirectory
Copy-Item -LiteralPath (Join-Path $distributionRoot "PRIVACY_AND_DATA.md") -Destination $stageDirectory
Copy-Item -LiteralPath (Join-Path $distributionRoot "SECURITY_AND_SUPPORT.md") -Destination $stageDirectory

$sourceEvidencePath = Join-Path $distributionRoot "RELEASE_EVIDENCE.md"
$packagedEvidencePath = Join-Path $stageDirectory "RELEASE_EVIDENCE.md"
$packagedEvidence = Get-Content -LiteralPath $sourceEvidencePath -Raw
try {
  $edmontonTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById("America/Edmonton")
} catch {
  $edmontonTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById("Mountain Standard Time")
}
$evidenceDate = [TimeZoneInfo]::ConvertTime($createdAt, $edmontonTimeZone).ToString("yyyy-MM-dd")
$packagedEvidence = [regex]::Replace(
  $packagedEvidence,
  '(?m)^Evidence date: \d{4}-\d{2}-\d{2} \(America/Edmonton\)[ \t]*\r?$',
  "Evidence date: $evidenceDate (America/Edmonton)  ",
  1
)
$sourceIdentityPattern = '(?s)The final ZIP does not yet exist, so its identifiers must not be guessed or copied from\s+an earlier image\. The release builder mechanically records the exact values as follows:'
if (-not [regex]::IsMatch($packagedEvidence, $sourceIdentityPattern)) {
  throw "RELEASE_EVIDENCE.md no longer contains the required honest pre-build identity statement."
}
$packagedEvidence = [regex]::Replace(
  $packagedEvidence,
  '(?m)^Candidate version: `[^`]+`[ \t]*\r?$',
  "Packaged version: ``$version``  ",
  1
)
$sourceRuntimeImagePattern = 'The source-reduced runtime image will be built and recorded by the release builder\.'
if (-not [regex]::IsMatch($packagedEvidence, $sourceRuntimeImagePattern)) {
  throw "RELEASE_EVIDENCE.md no longer contains the required honest pre-build runtime-image statement."
}
$packagedEvidence = [regex]::Replace(
  $packagedEvidence,
  $sourceRuntimeImagePattern,
  "The source-reduced runtime image ``$imageName`` built successfully.",
  1
)
if ($SkipVerification) {
  $packagedStatus = "Evidence status: UNVERIFIED developer artifact; engineering verification was skipped and this package must not be published"
  $packagedIdentity = "This UNVERIFIED developer artifact was assembled with engineering verification skipped. It must not be published or represented as a release. Internal payload identifiers are recorded for debugging as follows:"
} else {
  $packagedStatus = "Evidence status: verified package assembly; remaining live-provider, recovery, accessibility, and human release drills are listed below"
  $packagedIdentity = "This evidence file is packaged inside a verified archive payload. The builder ran the enabled engineering gates and records the payload identities below. The final outer ZIP SHA-256 is necessarily recorded beside the ZIP, not recursively inside itself:"
}
$packagedEvidence = [regex]::Replace(
  $packagedEvidence,
  '(?s)Evidence status: engineering candidate; final artifact identity and remaining release\s+drills must be completed before public publication',
  $packagedStatus,
  1
)
$packagedEvidence = [regex]::Replace($packagedEvidence, $sourceIdentityPattern, $packagedIdentity, 1)
if (-not $SkipVerification) {
  $packagedEvidence = [regex]::Replace(
    $packagedEvidence,
    '(?m)^- final build with verification enabled and exact archive/image/SBOM hashes;\r?\n',
    ""
  )
  $packagedEvidence = [regex]::Replace(
    $packagedEvidence,
    '(?m)^- final merged five-project browser rerun and automated release/accessibility/security\r?\n  contracts;\r?\n',
    ""
  )
  $packagedEvidence = [regex]::Replace(
    $packagedEvidence,
    '(?m)^- final production-dependency audit;\r?\n',
    ""
  )
}
if (-not $packagedEvidence.Contains($packagedStatus) -or
    -not $packagedEvidence.Contains($packagedIdentity) -or
    -not $packagedEvidence.Contains("Evidence date: $evidenceDate (America/Edmonton)") -or
    -not $packagedEvidence.Contains("Packaged version: ``$version``")) {
  throw "RELEASE_EVIDENCE.md could not be transformed into the required packaged evidence state."
}
[IO.File]::WriteAllText($packagedEvidencePath, $packagedEvidence, (New-Object System.Text.UTF8Encoding($false)))
foreach ($document in @(
  "docs\USER_ACCEPTANCE_SCRIPTS.md",
  "docs\BACKUP_AND_RECOVERY.md",
  "docs\CAD_USD_OPERATOR_GUIDE.md",
  "docs\SECURITY_AND_COMPLIANCE.md"
)) {
  Copy-Item -LiteralPath (Join-Path $repositoryRoot $document) -Destination $stageDirectory
}

$imageArchive = Join-Path $stageDirectory "clearledger-public-beta-image.tar"
docker pull $postgresImage
if ($LASTEXITCODE -ne 0) { throw "The pinned PostgreSQL runtime image could not be retrieved." }
docker save --output $imageArchive $imageName $postgresImage
if ($LASTEXITCODE -ne 0) { throw "The runtime image could not be saved." }

$containerInventoryPath = Join-Path $stageDirectory "container-package-inventory.txt"
$debianPackageInventory = @(docker run --rm --entrypoint dpkg-query $imageName '-W' '-f=${binary:Package}\t${Version}\n')
if ($LASTEXITCODE -ne 0) { throw "The ClearLedger container package inventory failed." }
$postgresPackageInventory = @(docker run --rm --entrypoint apk $postgresImage info -v)
if ($LASTEXITCODE -ne 0) { throw "The PostgreSQL container package inventory failed." }
[IO.File]::WriteAllLines(
  $containerInventoryPath,
  @("ClearLedger runtime (Debian packages)") + $debianPackageInventory + @("", "PostgreSQL runtime (Alpine packages)") + $postgresPackageInventory
)

$sbomPath = Join-Path $stageDirectory "ClearLedger-SBOM.cdx.json"
$dependencyInventoryPath = Join-Path $outputRoot ".pnpm-production-dependencies-$version-$PID.json"
try {
  & corepack pnpm -r list --prod --json --depth Infinity | Set-Content -LiteralPath $dependencyInventoryPath -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "The production dependency inventory could not be generated." }
  Get-Content -LiteralPath $dependencyInventoryPath -Raw | & node (Join-Path $scriptDirectory "generate-cyclonedx-sbom.mjs") $sbomPath
  if ($LASTEXITCODE -ne 0) { throw "The CycloneDX SBOM could not be generated." }
  & node (Join-Path $scriptDirectory "generate-third-party-notices.mjs") $dependencyInventoryPath (Join-Path $stageDirectory "THIRD_PARTY_NOTICES.md") (Join-Path $stageDirectory "third-party-licenses")
  if ($LASTEXITCODE -ne 0) { throw "Third-party licence notices could not be assembled." }
} finally {
  if (Test-Path -LiteralPath $dependencyInventoryPath) {
    Remove-Item -LiteralPath $dependencyInventoryPath -Force
  }
}

$imageInspectPath = Join-Path $stageDirectory "runtime-image-inspect.json"
docker image inspect $imageName | Set-Content -LiteralPath $imageInspectPath -Encoding UTF8
$imageId = (docker image inspect --format '{{.Id}}' $imageName).Trim()
$imageArchiveSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $imageArchive).Hash.ToLowerInvariant()
$sbomSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sbomPath).Hash.ToLowerInvariant()

$manifest = [ordered]@{
  product = "ClearLedger Public Beta"
  version = $version
  createdAt = $created
  image = $imageName
  imageId = $imageId
  imageArchiveSha256 = $imageArchiveSha256
  postgresImage = $postgresImage
  sbomSha256 = $sbomSha256
  sourceInputSha256 = $sourceInputSha256
  sourceInputFileCount = $sourceInputFiles.Count
  gateInputSha256 = $gateInputSha256
  gateInputFileCount = $gateInputFiles.Count
  migrationSetSha256 = $migrationSetSha256
  migrationCount = $migrationCount
  sourceReduced = $true
  localBinding = "127.0.0.1:3000"
  localPortConfigurable = $true
  verificationSkipped = [bool]$SkipVerification
  evidenceState = $evidenceState
  artifactName = $artifactName
  archiveFormat = "zip-with-docker-image-v1"
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText(
  (Join-Path $stageDirectory "release-manifest.json"),
  $manifestJson,
  (New-Object System.Text.UTF8Encoding($false))
)

$checksumPath = Join-Path $stageDirectory "SHA256SUMS.txt"
$checksumLines = Get-ChildItem -LiteralPath $stageDirectory -Recurse -File -ErrorAction Stop |
  Where-Object { $_.FullName -ne $checksumPath } |
  Sort-Object FullName |
  ForEach-Object {
    $relative = Get-ClearLedgerRelativePath $stageDirectory $_.FullName
    "$((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant())  $relative"
  }
[System.IO.File]::WriteAllLines($checksumPath, $checksumLines)

$expectedVerification = if ($SkipVerification) { "unverified" } else { "verified" }
& node (Join-Path $scriptDirectory "verify-public-beta-stage.mjs") $stageDirectory $version $expectedVerification
if ($LASTEXITCODE -ne 0) { throw "The assembled public-beta stage failed its integrity/privacy contract." }

[System.Reflection.Assembly]::LoadWithPartialName("System.IO.Compression.FileSystem") | Out-Null
try {
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageDirectory,
    $temporaryArchivePath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
  $archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporaryArchivePath).Hash.ToLowerInvariant()
  $expectedChecksumLine = "$archiveHash  $artifactName`r`n"
  [System.IO.File]::WriteAllText($temporaryChecksumPath, $expectedChecksumLine)
  if ((Get-Content -LiteralPath $temporaryChecksumPath -Raw) -ne $expectedChecksumLine) {
    throw "The staged archive checksum sidecar could not be verified before publication."
  }
  $finalGateInputFiles = @(Get-ClearLedgerGateInputFiles $gateInputPaths)
  $finalGateInputSha256 = Get-ClearLedgerFingerprint $finalGateInputFiles
  if ($finalGateInputFiles.Count -ne $gateInputFiles.Count -or $finalGateInputSha256 -ne $gateInputSha256) {
    throw "Release-gate inputs changed after verification began; no archive was promoted. Restart the build from a stable source tree."
  }
  Move-Item -LiteralPath $temporaryArchivePath -Destination $archivePath
  Move-Item -LiteralPath $temporaryChecksumPath -Destination $archiveChecksumPath
} finally {
  if (Test-Path -LiteralPath $temporaryArchivePath) { Remove-Item -LiteralPath $temporaryArchivePath -Force }
  if (Test-Path -LiteralPath $temporaryChecksumPath) { Remove-Item -LiteralPath $temporaryChecksumPath -Force }
}

Write-Host "Public beta archive: $archivePath"
Write-Host "SHA-256: $archiveHash"
Write-Host "Runtime image: $imageId"
