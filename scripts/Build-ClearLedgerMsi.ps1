[CmdletBinding()]
param(
  [string]$PackageZip,
  [string]$OutputDirectory,
  [switch]$RestoreWixTool,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory ".."))
$distributionRoot = Join-Path $repositoryRoot "distribution\public-beta"
$defaultOutputDirectory = Join-Path $distributionRoot "output"
$wixSource = Join-Path $distributionRoot "msi\Product.wxs"
$msiGuidanceSource = Join-Path $distributionRoot "msi\MSI_INSTALLATION.md"
$toolManifest = Join-Path $repositoryRoot ".config\dotnet-tools.json"
$expectedWixVersion = "6.0.2"
$upgradeCode = "{742B66D8-A735-4874-A6DB-3B3C10D7FD91}"
$installedGuidanceName = "MSI_INSTALLATION.md"
$installedProvenanceName = "MSI_PROVENANCE.json"
$requiredPayloadFiles = @(
  "BETA_LICENSE.txt",
  "BACKUP_AND_RECOVERY.md",
  "Backup-ClearLedger.ps1",
  "Compose-Compatibility.ps1",
  "CAD_USD_OPERATOR_GUIDE.md",
  "ClearLedger-SBOM.cdx.json",
  "Diagnose-ClearLedger.ps1",
  "INSTALL_WINDOWS.md",
  "KNOWN_LIMITATIONS.md",
  "PRIVACY_AND_DATA.md",
  "RELEASE_EVIDENCE.md",
  "Restore-ClearLedger.ps1",
  "SECURITY_AND_SUPPORT.md",
  "SECURITY_AND_COMPLIANCE.md",
  "SHA256SUMS.txt",
  "Share-ClearLedger.ps1",
  "Start-ClearLedger.ps1",
  "Test-ClearLedgerPrerequisites.ps1",
  "Stop-ClearLedger.ps1",
  "Stop-ClearLedgerShare.ps1",
  "THIRD_PARTY_NOTICES.md",
  "Uninstall-ClearLedger.ps1",
  "USER_ACCEPTANCE_SCRIPTS.md",
  "Update-ClearLedger.ps1",
  "clearledger-public-beta-image.tar",
  "compose.share.yaml",
  "compose.yaml",
  "container-package-inventory.txt",
  "release-manifest.json",
  "runtime-image-inspect.json"
)
$requiredPayloadFileSet = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($requiredPayloadFile in $requiredPayloadFiles) {
  [void]$requiredPayloadFileSet.Add($requiredPayloadFile)
}
$allowedPayloadDirectory = "third-party-licenses"

function Get-ClearLedgerHashText([string]$Value) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
  }
}

function Get-ClearLedgerGuid([string]$Value) {
  $hash = Get-ClearLedgerHashText $Value
  return ([Guid]::ParseExact($hash.Substring(0, 32), "N")).ToString("B").ToUpperInvariant()
}

function Assert-ClearLedgerChildPath([string]$Parent, [string]$Candidate) {
  $parentPrefix = [IO.Path]::GetFullPath($Parent).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  $candidatePath = [IO.Path]::GetFullPath($Candidate)
  if (-not $candidatePath.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a path outside $parentPrefix"
  }
  return $candidatePath
}

function Test-ClearLedgerLicensePayloadPath([string]$Path, [bool]$IsDirectory) {
  $parts = @($Path.Split('/'))
  if ($parts.Count -lt 1 -or -not $parts[0].Equals($allowedPayloadDirectory, [StringComparison]::Ordinal)) {
    return $false
  }
  if ($parts.Count -ge 2 -and ($parts[1] -eq '.' -or $parts[1] -eq '..')) {
    return $false
  }
  if ($IsDirectory) {
    return $parts.Count -eq 1 -or
      ($parts.Count -eq 2 -and $parts[1] -match '^[A-Za-z0-9._-]{1,28}$')
  }
  return $parts.Count -eq 3 -and
    $parts[1] -match '^[A-Za-z0-9._-]{1,28}$' -and
    $parts[2] -match '^(?i:licen[cs]e|copying|notice)(?:\.[A-Za-z0-9._-]{1,64})?$' -and
    $parts[2] -notmatch '(?i)\.(?:key|p12|pem|pfx)$'
}

function Write-ClearLedgerUtf8Json([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($Path, $json + "`r`n", (New-Object Text.UTF8Encoding($false)))
}

if (-not (Test-Path -LiteralPath $wixSource -PathType Leaf)) {
  throw "The ClearLedger WiX source is missing: $wixSource"
}
if (-not (Test-Path -LiteralPath $msiGuidanceSource -PathType Leaf)) {
  throw "The installed MSI guidance is missing: $msiGuidanceSource"
}
if (-not (Test-Path -LiteralPath $toolManifest -PathType Leaf)) {
  throw "The repository-local .NET tool manifest is missing: $toolManifest"
}
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "A .NET 6 or newer SDK is required to run the repository-pinned WiX tool."
}
$installedSdkVersions = @(& dotnet --list-sdks 2>$null)
$supportedSdk = @(
  $installedSdkVersions |
    Where-Object { $_ -match '^(?<Major>[0-9]+)\.' -and [int]$Matches.Major -ge 6 }
)
if ($supportedSdk.Count -lt 1) {
  throw "A .NET 6 or newer SDK is required. A dotnet runtime alone cannot restore or run WiX."
}

if (-not $PackageZip) {
  $candidates = @(
    Get-ChildItem -LiteralPath $defaultOutputDirectory -Filter "ClearLedger-Public-Beta-*.zip" -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch 'UNVERIFIED' }
  )
  if ($candidates.Count -ne 1) {
    throw "Specify -PackageZip. Automatic selection requires exactly one verified public-beta ZIP in $defaultOutputDirectory."
  }
  $PackageZip = $candidates[0].FullName
}

$packagePath = [IO.Path]::GetFullPath($PackageZip)
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "The public-beta ZIP does not exist: $packagePath"
}
$packageName = [IO.Path]::GetFileName($packagePath)
if ($packageName -match 'UNVERIFIED' -or
    $packageName -notmatch '^ClearLedger-Public-Beta-(?<Version>[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\.zip$') {
  throw "The MSI builder accepts only a verified ClearLedger-Public-Beta-<version>.zip artifact."
}
$displayVersion = [string]$Matches.Version
$semanticVersion = [regex]::Match(
  $displayVersion,
  '^(?<Major>[0-9]+)\.(?<Minor>[0-9]+)\.(?<Patch>[0-9]+)(?:-(?<Label>alpha|beta|rc)\.(?<Sequence>[0-9]+))?$'
)
if (-not $semanticVersion.Success) {
  throw "MSI releases must use a stable version or alpha.N, beta.N, or rc.N prerelease: $displayVersion"
}
$msiMajor = [int]$semanticVersion.Groups['Major'].Value
$msiMinor = [int]$semanticVersion.Groups['Minor'].Value
$semanticPatch = [int]$semanticVersion.Groups['Patch'].Value
if ($msiMajor -gt 255 -or $msiMinor -gt 255 -or $semanticPatch -gt 64) {
  throw "The release version is outside ClearLedger's monotonic Windows Installer version range: $displayVersion"
}
$prereleaseRank = 999
if ($semanticVersion.Groups['Label'].Success) {
  $sequence = [int]$semanticVersion.Groups['Sequence'].Value
  if ($sequence -lt 1 -or $sequence -gt 99) {
    throw "MSI prerelease sequence numbers must be from 1 through 99: $displayVersion"
  }
  $prereleaseRank = switch ($semanticVersion.Groups['Label'].Value) {
    'alpha' { 100 + $sequence }
    'beta' { 300 + $sequence }
    'rc' { 600 + $sequence }
    default { throw "Unsupported MSI prerelease label: $displayVersion" }
  }
}
$msiBuild = ($semanticPatch * 1000) + $prereleaseRank
$msiVersion = "$msiMajor.$msiMinor.$msiBuild"
$productCode = Get-ClearLedgerGuid "ClearLedger.PublicBeta.Product.v1|$displayVersion"

$checksumPath = "$packagePath.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
  throw "The verified ZIP must have a sibling checksum file: $checksumPath"
}
$checksumLines = @(
  Get-Content -LiteralPath $checksumPath |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
)
if ($checksumLines.Count -ne 1 -or
    $checksumLines[0] -notmatch '^(?<Hash>[a-fA-F0-9]{64})[ \t]{2}(?<Name>[^\\/:]+)$') {
  throw "The ZIP checksum file must contain exactly: <64 hex characters><two spaces><ZIP filename>."
}
$expectedArchiveHash = [string]$Matches.Hash
$checksumFileName = [string]$Matches.Name
if (-not $checksumFileName.Equals($packageName, [StringComparison]::Ordinal)) {
  throw "The checksum file names $checksumFileName, not $packageName."
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageStream = New-Object IO.FileStream(
  $packagePath,
  [IO.FileMode]::Open,
  [IO.FileAccess]::Read,
  [IO.FileShare]::Read
)
$archive = $null
try {
  $archiveHasher = [Security.Cryptography.SHA256]::Create()
  try {
    $actualArchiveHash = ([BitConverter]::ToString($archiveHasher.ComputeHash($packageStream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $archiveHasher.Dispose()
  }
  if (-not $actualArchiveHash.Equals($expectedArchiveHash, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The public-beta ZIP failed its sibling SHA-256 check."
  }
  $packageStream.Position = 0
  $archive = New-Object IO.Compression.ZipArchive(
    $packageStream,
    [IO.Compression.ZipArchiveMode]::Read,
    $true
  )

  $entryNames = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $fileEntries = New-Object 'Collections.Generic.Dictionary[string,IO.Compression.ZipArchiveEntry]' ([StringComparer]::Ordinal)
  $manifestEntry = $null
  foreach ($entry in $archive.Entries) {
    $entryName = $entry.FullName.Replace('\', '/')
    $isDirectoryEntry = $entryName.EndsWith('/') -or [string]::IsNullOrEmpty($entry.Name)
    $normalizedEntryName = $entryName.TrimEnd([char[]]@('/'))
    $entryParts = @($normalizedEntryName.Split('/'))
    if ([string]::IsNullOrWhiteSpace($normalizedEntryName) -or
        $normalizedEntryName.StartsWith('/') -or
        $normalizedEntryName -match '^[A-Za-z]:' -or
        $normalizedEntryName.Contains(':') -or
        @($entryParts | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
      throw "The ZIP contains an unsafe path: $entryName"
    }
    if (-not $entryNames.Add($entryName)) {
      throw "The ZIP contains duplicate case-insensitive paths: $entryName"
    }
    if ($isDirectoryEntry) {
      if (-not (Test-ClearLedgerLicensePayloadPath $normalizedEntryName $true)) {
        throw "The ZIP contains an unexpected directory: $entryName"
      }
    } elseif (Test-ClearLedgerLicensePayloadPath $normalizedEntryName $false) {
      $fileEntries.Add($normalizedEntryName, $entry)
    } elseif ($entryParts.Count -ne 1 -or -not $requiredPayloadFileSet.Contains($normalizedEntryName)) {
      throw "The ZIP contains an unexpected public-beta file: $entryName"
    } else {
      $fileEntries.Add($normalizedEntryName, $entry)
    }
    $unixFileType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
    if ($unixFileType -eq 0xA000) {
      throw "The ZIP contains a symbolic link, which is not accepted: $entryName"
    }
    if ($entryName -match '(?i)(^|/)(beta\.env|share\.env|\.env|\.license-accepted)([./]|$)' -or
        $entryName -match '(?i)(^|/)(Backups|\.data)(/|$)' -or
        $entryName -match '(?i)(^|/)(credentials|secrets)\.json$' -or
        $entryName -match '(?i)(^|/)(id_rsa|id_ed25519)(\.pub)?$' -or
        $entryName -match '(?i)\.(pfx|p12|pem|key)$') {
      throw "The ZIP contains state or a possible secret-bearing file that must never enter the MSI: $entryName"
    }
    if (-not $isDirectoryEntry -and
        $normalizedEntryName.Equals("release-manifest.json", [StringComparison]::Ordinal)) {
      $manifestEntry = $entry
    }
  }

  foreach ($requiredEntry in $requiredPayloadFiles) {
    if (-not $fileEntries.ContainsKey($requiredEntry)) {
      throw "The verified package is incomplete. Missing $requiredEntry."
    }
  }

  $checksumReader = New-Object IO.StreamReader(
    $fileEntries["SHA256SUMS.txt"].Open(),
    [Text.Encoding]::UTF8,
    $true
  )
  try {
    $internalChecksumText = $checksumReader.ReadToEnd().TrimStart([char[]]@(0xFEFF))
  } finally {
    $checksumReader.Dispose()
  }
  $internalChecksumLines = @(
    $internalChecksumText -split '\r?\n' |
      Where-Object { $_.Length -gt 0 }
  )
  $internalChecksums = @{}
  foreach ($checksumLine in $internalChecksumLines) {
    $checksumMatch = [regex]::Match(
      $checksumLine,
      '^(?<Hash>[a-f0-9]{64})  (?<Path>[^\\/:\r\n]+(?:/[^\\/:\r\n]+)*)$'
    )
    if (-not $checksumMatch.Success) {
      throw "The ZIP contains a malformed SHA256SUMS.txt entry: $checksumLine"
    }
    $checksumEntryName = [string]$checksumMatch.Groups['Path'].Value
    if ($checksumEntryName.Equals("SHA256SUMS.txt", [StringComparison]::OrdinalIgnoreCase) -or
        -not $fileEntries.ContainsKey($checksumEntryName) -or
        $internalChecksums.ContainsKey($checksumEntryName)) {
      throw "The ZIP checksum inventory contains an unexpected or duplicate path: $checksumEntryName"
    }
    $internalChecksums[$checksumEntryName] = [string]$checksumMatch.Groups['Hash'].Value
  }
  if ($internalChecksums.Count -ne ($fileEntries.Count - 1)) {
    throw "The ZIP checksum inventory must contain exactly one entry for every payload file except SHA256SUMS.txt."
  }
  foreach ($payloadEntryName in $fileEntries.Keys) {
    if ($payloadEntryName.Equals("SHA256SUMS.txt", [StringComparison]::OrdinalIgnoreCase)) { continue }
    if (-not $internalChecksums.ContainsKey($payloadEntryName)) {
      throw "The ZIP checksum inventory is missing $payloadEntryName."
    }
    $payloadEntryStream = $fileEntries[$payloadEntryName].Open()
    $payloadHasher = [Security.Cryptography.SHA256]::Create()
    try {
      $actualPayloadHash = ([BitConverter]::ToString($payloadHasher.ComputeHash($payloadEntryStream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $payloadHasher.Dispose()
      $payloadEntryStream.Dispose()
    }
    if (-not $actualPayloadHash.Equals([string]$internalChecksums[$payloadEntryName], [StringComparison]::Ordinal)) {
      throw "The ZIP payload failed its internal SHA-256 check: $payloadEntryName"
    }
  }

  $noticesReader = New-Object IO.StreamReader(
    $fileEntries["THIRD_PARTY_NOTICES.md"].Open(),
    [Text.Encoding]::UTF8,
    $true
  )
  try {
    $thirdPartyNoticesText = $noticesReader.ReadToEnd().TrimStart([char[]]@(0xFEFF))
  } finally {
    $noticesReader.Dispose()
  }
  $referencedLicenseFiles = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  foreach ($noticePathMatch in [regex]::Matches(
      $thirdPartyNoticesText,
      '`(?<Path>third-party-licenses/[^`\r\n]+)`'
    )) {
    $noticePath = [string]$noticePathMatch.Groups['Path'].Value
    if (-not (Test-ClearLedgerLicensePayloadPath $noticePath $false)) {
      throw "THIRD_PARTY_NOTICES.md references an invalid licence payload path: $noticePath"
    }
    if (-not $referencedLicenseFiles.Add($noticePath)) {
      throw "THIRD_PARTY_NOTICES.md references a licence payload path more than once: $noticePath"
    }
  }
  $actualLicenseFiles = @(
    $fileEntries.Keys |
      Where-Object { $_.StartsWith("$allowedPayloadDirectory/", [StringComparison]::Ordinal) }
  )
  if ($actualLicenseFiles.Count -ne $referencedLicenseFiles.Count) {
    throw "The ZIP licence payload must exactly match the files referenced by THIRD_PARTY_NOTICES.md."
  }
  foreach ($licenseFile in $actualLicenseFiles) {
    if (-not $referencedLicenseFiles.Contains($licenseFile)) {
      throw "The ZIP contains an unreferenced third-party licence file: $licenseFile"
    }
  }
  foreach ($licenseFile in $referencedLicenseFiles) {
    if (-not $fileEntries.ContainsKey($licenseFile)) {
      throw "THIRD_PARTY_NOTICES.md references a missing third-party licence file: $licenseFile"
    }
  }

  $manifestReader = New-Object IO.StreamReader($manifestEntry.Open(), [Text.Encoding]::UTF8, $true)
  try {
    $releaseManifest = $manifestReader.ReadToEnd() | ConvertFrom-Json
  } finally {
    $manifestReader.Dispose()
  }
  $releaseCreatedAtText = [string]$releaseManifest.createdAt
  $parsedReleaseCreatedAt = [DateTimeOffset]::MinValue
  $releaseCreatedAtValid =
    $releaseCreatedAtText -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$' -and
    [DateTimeOffset]::TryParse(
      $releaseCreatedAtText,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind,
      [ref]$parsedReleaseCreatedAt
    ) -and
    $parsedReleaseCreatedAt.Offset -eq [TimeSpan]::Zero
  if ($releaseManifest.product -ne "ClearLedger Public Beta" -or
      [string]$releaseManifest.version -ne $displayVersion -or
      [string]$releaseManifest.image -ne "clearledger/public-beta:$displayVersion" -or
      [string]$releaseManifest.artifactName -ne $packageName -or
      $releaseManifest.verificationSkipped -ne $false -or
      [string]$releaseManifest.evidenceState -ne "verified-package-assembly" -or
      $releaseManifest.sourceReduced -ne $true -or
      [string]$releaseManifest.archiveFormat -ne "zip-with-docker-image-v1" -or
      [string]$releaseManifest.postgresImage -ne
        "postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193" -or
      [string]$releaseManifest.localBinding -ne "127.0.0.1:3000" -or
      $releaseManifest.localPortConfigurable -ne $true -or
      ([string]$releaseManifest.imageId) -notmatch '^sha256:[a-f0-9]{64}$' -or
      ([string]$releaseManifest.imageArchiveSha256) -notmatch '^[a-f0-9]{64}$' -or
      ([string]$releaseManifest.sbomSha256) -notmatch '^[a-f0-9]{64}$' -or
      ([string]$releaseManifest.sourceInputSha256) -notmatch '^[a-f0-9]{64}$' -or
      ([string]$releaseManifest.gateInputSha256) -notmatch '^[a-f0-9]{64}$' -or
      ([string]$releaseManifest.migrationSetSha256) -notmatch '^[a-f0-9]{64}$' -or
      -not $releaseCreatedAtValid -or
      ([string]$releaseManifest.sourceInputFileCount) -notmatch '^[1-9][0-9]*$' -or
      ([string]$releaseManifest.gateInputFileCount) -notmatch '^[1-9][0-9]*$' -or
      [long]$releaseManifest.gateInputFileCount -lt [long]$releaseManifest.sourceInputFileCount -or
      ([string]$releaseManifest.migrationCount) -notmatch '^[1-9][0-9]*$' -or
      -not ([string]$releaseManifest.imageArchiveSha256).Equals(
        [string]$internalChecksums["clearledger-public-beta-image.tar"],
        [StringComparison]::Ordinal
      ) -or
      -not ([string]$releaseManifest.sbomSha256).Equals(
        [string]$internalChecksums["ClearLedger-SBOM.cdx.json"],
        [StringComparison]::Ordinal
      )) {
    throw "The ZIP release manifest does not identify the expected verified, source-reduced public beta."
  }

  $sourceInventoryLines = New-Object 'Collections.Generic.List[string]'
  foreach ($sourceInventoryPath in $internalChecksums.Keys) {
    $sourceInventoryLines.Add("$($internalChecksums[$sourceInventoryPath])  $sourceInventoryPath")
  }
  $sourceInventoryLines.Sort([StringComparer]::Ordinal)
  $sourcePayloadInventorySha256 = Get-ClearLedgerHashText(
    [string]::Join("`n", $sourceInventoryLines) + "`n"
  )

  Push-Location -LiteralPath $repositoryRoot
  try {
    if ($RestoreWixTool) {
      & dotnet tool restore --tool-manifest $toolManifest
      if ($LASTEXITCODE -ne 0) { throw "The repository-pinned WiX tool restore failed." }
    }
    $wixVersionOutput = @(& dotnet tool run wix -- --version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "WiX is not restored. Run 'dotnet tool restore' at the repository root, or opt in with -RestoreWixTool."
    }
    $wixVersionText = ($wixVersionOutput -join "`n").Trim()
    if ($wixVersionText -notmatch "^$([regex]::Escape($expectedWixVersion))(?:[+-].*)?$") {
      throw "Expected repository-pinned WiX $expectedWixVersion, but found: $wixVersionText"
    }
  } finally {
    Pop-Location
  }

  if (-not $OutputDirectory) { $OutputDirectory = $defaultOutputDirectory }
  $resolvedOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
  New-Item -ItemType Directory -Path $resolvedOutputDirectory -Force | Out-Null
  $outputMsi = Join-Path $resolvedOutputDirectory "ClearLedger-Public-Beta-$displayVersion-x64.msi"
  $outputChecksum = "$outputMsi.sha256"
  $outputProvenance = "$outputMsi.provenance.json"
  $outputProvenanceChecksum = "$outputProvenance.sha256"
  $outputArtifacts = @($outputMsi, $outputChecksum, $outputProvenance, $outputProvenanceChecksum)
  $existingOutputArtifacts = @($outputArtifacts | Where-Object { Test-Path -LiteralPath $_ })
  if ($existingOutputArtifacts.Count -gt 0 -and -not $Force) {
    throw "An MSI output artifact already exists. Use -Force to replace the complete artifact set: $($existingOutputArtifacts -join ', ')"
  }

  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $workDirectory = Join-Path $temporaryRoot "ClearLedgerMsi-$PID-$([Guid]::NewGuid().ToString('N'))"
  $workDirectory = Assert-ClearLedgerChildPath $temporaryRoot $workDirectory
  $payloadRoot = Join-Path $workDirectory "payload"
  $intermediateRoot = Join-Path $workDirectory "obj"
  $generatedSource = Join-Path $workDirectory "Payload.wxs"
  $stagedMsi = Join-Path $workDirectory "ClearLedger-Public-Beta-$displayVersion-x64.msi"
  $stagedChecksum = "$stagedMsi.sha256"
  $stagedProvenance = "$stagedMsi.provenance.json"
  $stagedProvenanceChecksum = "$stagedProvenance.sha256"

  try {
    New-Item -ItemType Directory -Path $payloadRoot, $intermediateRoot -Force | Out-Null
    $payloadPrefix = [IO.Path]::GetFullPath($payloadRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $archive.Entries) {
      $entryName = $entry.FullName.Replace('\', '/')
      $destination = [IO.Path]::GetFullPath((Join-Path $payloadRoot $entryName.Replace('/', '\')))
      if (-not $destination.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to extract a ZIP path outside the MSI staging directory: $entryName"
      }
      if ($entryName.EndsWith('/')) {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        continue
      }
      $destinationParent = Split-Path -Parent $destination
      New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
      $entryStream = $entry.Open()
      $fileStream = New-Object IO.FileStream($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try {
        $entryStream.CopyTo($fileStream)
      } finally {
        $fileStream.Dispose()
        $entryStream.Dispose()
      }
    }

    $msiBuildCreatedAt = [DateTimeOffset]::UtcNow.ToString(
      "o",
      [Globalization.CultureInfo]::InvariantCulture
    )
    Copy-Item -LiteralPath $msiGuidanceSource -Destination (Join-Path $payloadRoot $installedGuidanceName)
    $installedProvenance = [ordered]@{
      schemaVersion = 1
      product = "ClearLedger Public Beta MSI wrapper"
      displayVersion = $displayVersion
      windowsInstallerVersion = $msiVersion
      architecture = "x64"
      productCode = $productCode
      upgradeCode = $upgradeCode
      installScope = "perUser"
      buildCreatedAt = $msiBuildCreatedAt
      wixVersion = $expectedWixVersion
      sourceArchive = [ordered]@{
        name = $packageName
        sha256 = $actualArchiveHash
        releaseManifestSha256 = [string]$internalChecksums["release-manifest.json"]
        releaseCreatedAt = $releaseCreatedAtText
        imageId = [string]$releaseManifest.imageId
        imageArchiveSha256 = [string]$releaseManifest.imageArchiveSha256
        sbomSha256 = [string]$releaseManifest.sbomSha256
        sourceInputSha256 = [string]$releaseManifest.sourceInputSha256
        sourceInputFileCount = [long]$releaseManifest.sourceInputFileCount
        gateInputSha256 = [string]$releaseManifest.gateInputSha256
        gateInputFileCount = [long]$releaseManifest.gateInputFileCount
        migrationSetSha256 = [string]$releaseManifest.migrationSetSha256
        migrationCount = [long]$releaseManifest.migrationCount
      }
      sourcePayload = [ordered]@{
        archiveFileCount = $fileEntries.Count
        checksummedFileCount = $internalChecksums.Count
        inventorySha256 = $sourcePayloadInventorySha256
      }
      guidance = $installedGuidanceName
      signed = $false
      wixValidation = "required-before-output-promotion"
      finalMsiSha256Location = "Use the sibling .msi.sha256 file and external .msi.provenance.json published with the final MSI."
    }
    Write-ClearLedgerUtf8Json (Join-Path $payloadRoot $installedProvenanceName) $installedProvenance

    $payloadFiles = @(Get-ChildItem -LiteralPath $payloadRoot -Recurse -File | Sort-Object FullName)
    if ($payloadFiles.Count -lt 1) { throw "The public-beta ZIP did not yield an MSI payload." }

    $xmlSettings = New-Object Xml.XmlWriterSettings
    $xmlSettings.Indent = $true
    $xmlSettings.Encoding = New-Object Text.UTF8Encoding($false)
    $xmlWriter = [Xml.XmlWriter]::Create($generatedSource, $xmlSettings)
    try {
      $namespace = "http://wixtoolset.org/schemas/v4/wxs"
      $xmlWriter.WriteStartDocument()
      $xmlWriter.WriteStartElement("Wix", $namespace)
      $xmlWriter.WriteStartElement("Fragment", $namespace)
      $xmlWriter.WriteStartElement("ComponentGroup", $namespace)
      $xmlWriter.WriteAttributeString("Id", "PayloadComponents")
      $xmlWriter.WriteAttributeString("Directory", "INSTALLFOLDER")
      foreach ($file in $payloadFiles) {
        $relativePath = $file.FullName.Substring($payloadPrefix.Length).Replace('\', '/')
        $identityHash = Get-ClearLedgerHashText $relativePath.ToLowerInvariant()
        $componentId = "cmp_$($identityHash.Substring(0, 24))"
        $fileId = "fil_$($identityHash.Substring(0, 24))"
        $componentGuid = Get-ClearLedgerGuid "ClearLedger.PublicBeta.Payload.v1|$($relativePath.ToLowerInvariant())"
        $relativeDirectory = [IO.Path]::GetDirectoryName($relativePath.Replace('/', '\'))

        $xmlWriter.WriteStartElement("Component", $namespace)
        $xmlWriter.WriteAttributeString("Id", $componentId)
        $xmlWriter.WriteAttributeString("Guid", $componentGuid)
        if ($relativeDirectory) { $xmlWriter.WriteAttributeString("Subdirectory", $relativeDirectory) }
        $xmlWriter.WriteStartElement("File", $namespace)
        $xmlWriter.WriteAttributeString("Id", $fileId)
        $xmlWriter.WriteAttributeString("Source", $file.FullName)
        $xmlWriter.WriteAttributeString("Name", $file.Name)
        $xmlWriter.WriteEndElement()
        $xmlWriter.WriteStartElement("RegistryValue", $namespace)
        $xmlWriter.WriteAttributeString("Root", "HKCU")
        $xmlWriter.WriteAttributeString("Key", "Software\ClearLedger\PublicBeta\InstallerFiles")
        $xmlWriter.WriteAttributeString("Name", $identityHash)
        $xmlWriter.WriteAttributeString("Type", "integer")
        $xmlWriter.WriteAttributeString("Value", "1")
        $xmlWriter.WriteAttributeString("KeyPath", "yes")
        $xmlWriter.WriteEndElement()
        $xmlWriter.WriteEndElement()
      }
      $xmlWriter.WriteEndElement()
      $xmlWriter.WriteEndElement()
      $xmlWriter.WriteEndElement()
      $xmlWriter.WriteEndDocument()
    } finally {
      $xmlWriter.Dispose()
    }

    Push-Location -LiteralPath $repositoryRoot
    try {
      & dotnet tool run wix -- build `
        -arch x64 `
        -d "MsiVersion=$msiVersion" `
        -d "DisplayVersion=$displayVersion" `
        -d "ProductCode=$productCode" `
        -d "UpgradeCode=$upgradeCode" `
        -intermediateFolder $intermediateRoot `
        -out $stagedMsi `
        $wixSource $generatedSource
      if ($LASTEXITCODE -ne 0) { throw "WiX failed to build the ClearLedger MSI." }
      # WiX's ICE64 validator treats every generated payload directory under
      # PerUserProgramFilesFolder as a removable user-profile directory. The
      # MSI is intentionally per-user and retains its install tree on uninstall
      # only through MSI-owned components; ICE64 therefore reports false
      # positives for this generated tree (including WiX's own standard
      # directory). Keep the full standard validation suite and suppress only
      # this known per-user directory heuristic.
      & dotnet tool run wix -- msi validate -intermediateFolder $intermediateRoot -sice ICE64 $stagedMsi
      if ($LASTEXITCODE -ne 0) { throw "The generated ClearLedger MSI failed WiX validation." }
    } finally {
      Pop-Location
    }

    $msiHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedMsi).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
      $stagedChecksum,
      "$msiHash  $([IO.Path]::GetFileName($outputMsi))`r`n",
      (New-Object Text.UTF8Encoding($false))
    )
    $externalProvenance = [ordered]@{
      schemaVersion = 1
      product = "ClearLedger Public Beta MSI wrapper"
      displayVersion = $displayVersion
      windowsInstallerVersion = $msiVersion
      architecture = "x64"
      productCode = $productCode
      upgradeCode = $upgradeCode
      installScope = "perUser"
      buildCreatedAt = $msiBuildCreatedAt
      wixVersion = $expectedWixVersion
      wixValidation = "passed (ICE64 suppressed for intentional per-user payload tree)"
      sourceArchive = [ordered]@{
        name = $packageName
        sha256 = $actualArchiveHash
        releaseManifestSha256 = [string]$internalChecksums["release-manifest.json"]
        gateInputSha256 = [string]$releaseManifest.gateInputSha256
        gateInputFileCount = [long]$releaseManifest.gateInputFileCount
      }
      msi = [ordered]@{
        name = [IO.Path]::GetFileName($outputMsi)
        sha256 = $msiHash
        signed = $false
        artifactState = "unsigned-development-output"
      }
      signingRequiredBeforePublicDistribution = $true
      installedProvenance = $installedProvenanceName
      installedGuidance = $installedGuidanceName
    }
    Write-ClearLedgerUtf8Json $stagedProvenance $externalProvenance
    $provenanceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stagedProvenance).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
      $stagedProvenanceChecksum,
      "$provenanceHash  $([IO.Path]::GetFileName($outputProvenance))`r`n",
      (New-Object Text.UTF8Encoding($false))
    )

    if ($Force) {
      foreach ($outputArtifact in $outputArtifacts) {
        if (Test-Path -LiteralPath $outputArtifact) {
          Remove-Item -LiteralPath $outputArtifact -Force
        }
      }
    }
    Move-Item -LiteralPath $stagedMsi -Destination $outputMsi
    Move-Item -LiteralPath $stagedChecksum -Destination $outputChecksum
    Move-Item -LiteralPath $stagedProvenance -Destination $outputProvenance
    Move-Item -LiteralPath $stagedProvenanceChecksum -Destination $outputProvenanceChecksum
    Write-Host "ClearLedger MSI: $outputMsi"
    Write-Host "SHA-256: $msiHash"
    Write-Host "Build provenance: $outputProvenance"
    Write-Host "Artifact state: unsigned development output; sign and regenerate release evidence before public distribution."
    Write-Host "Install scope: current user ($env:LOCALAPPDATA\Programs\ClearLedger Public Beta)"
    Write-Host "Docker was not installed or changed; MSI removal does not call Docker or delete Docker data."
  } finally {
    if (Test-Path -LiteralPath $workDirectory) {
      $validatedWorkDirectory = Assert-ClearLedgerChildPath $temporaryRoot $workDirectory
      Remove-Item -LiteralPath $validatedWorkDirectory -Recurse -Force
    }
  }
} finally {
  if ($null -ne $archive) { $archive.Dispose() }
  $packageStream.Dispose()
}
