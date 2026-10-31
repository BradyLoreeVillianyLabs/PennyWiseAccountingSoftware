[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Package,
  [Parameter(Mandatory)] [string]$ExpectedPublisher,
  [string]$UpgradePackage,
  [switch]$AllowUntrustedQaCertificate,
  [switch]$RebootAfterInstall,
  [switch]$ResumeAfterReboot,
  [string]$StatePath,
  [switch]$UninstallAtEnd
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($StatePath)) {
  $stateRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
  $StatePath = Join-Path $stateRoot 'PennyWiseMsixLifecycleDrill\state.json'
}
if ($RebootAfterInstall -and $ResumeAfterReboot) { throw 'Choose only one of -RebootAfterInstall or -ResumeAfterReboot.' }

function Require([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Read-MsixPackageIdentity([string]$PackagePath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($PackagePath)
  try {
    $entry = $archive.GetEntry('AppxManifest.xml')
    if ($null -eq $entry) { throw "MSIX is missing AppxManifest.xml: $PackagePath" }
    $stream = $entry.Open()
    try {
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
      try {
        $manifestText = $reader.ReadToEnd()
      } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
  } finally { $archive.Dispose() }

  if ([string]::IsNullOrWhiteSpace($manifestText)) { throw "MSIX manifest is empty: $PackagePath" }
  [xml]$manifestDocument = $manifestText
  $identity = $manifestDocument.DocumentElement.SelectSingleNode("*[local-name()='Identity']")
  if ($null -eq $identity) { throw "MSIX manifest has no package identity: $PackagePath" }
  [pscustomobject]@{
    Name = $identity.GetAttribute('Name')
    Publisher = $identity.GetAttribute('Publisher')
    Version = $identity.GetAttribute('Version')
  }
}

function Get-PennyWisePackage {
  Get-AppxPackage -Name 'TypeWritingMonkeys.PennyWiseAccounting' -ErrorAction SilentlyContinue |
    Sort-Object Version -Descending |
    Select-Object -First 1
}

$resolvedPackage = (Resolve-Path -LiteralPath $Package).Path
$packageIdentity = Read-MsixPackageIdentity -PackagePath $resolvedPackage
Require ($packageIdentity.Name -eq 'TypeWritingMonkeys.PennyWiseAccounting') 'The supplied MSIX is not PennyWise Accounting.'
Require ($packageIdentity.Publisher -eq $ExpectedPublisher) 'MSIX publisher does not match the expected Store/QA publisher.'

$certificate = Get-AuthenticodeSignature -LiteralPath $resolvedPackage
Require ($certificate.Status -eq 'Valid' -or $AllowUntrustedQaCertificate) "MSIX signature is $($certificate.Status). Use a trusted Store signature, or pass -AllowUntrustedQaCertificate only for the documented QA certificate."

if ($ResumeAfterReboot) {
  Require (Test-Path -LiteralPath $StatePath) "Reboot state is missing: $StatePath"
  $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
  Require ($state.schemaVersion -eq 1 -and $state.phase -eq 'awaiting-reboot') 'The reboot state file is not a supported PennyWise lifecycle state.'
  $installed = Get-PennyWisePackage
  Require ($null -ne $installed) 'PennyWise is not registered after reboot.'
  Require ($installed.PackageFullName -eq $state.packageFullName) 'PennyWise package identity changed across reboot.'
  Require ($installed.PublisherId -eq $state.publisherId) 'PennyWise publisher identity changed across reboot.'
  Require ([version]$installed.Version -eq [version]$state.version) 'PennyWise package version changed across reboot.'
  Write-Host "Reboot continuity passed: $($installed.PackageFullName)"
  Remove-Item -LiteralPath $StatePath -Force
} else {
  $before = Get-PennyWisePackage
  Write-Host "Installing $($packageIdentity.Version) (previous: $($before.Version))"
  Add-AppxPackage -Path $resolvedPackage -ForceApplicationShutdown
  $installed = Get-PennyWisePackage
  Require ($null -ne $installed) 'MSIX install completed without a registered PennyWise package.'
  Require ($installed.Publisher -eq $packageIdentity.Publisher) 'Installed package publisher does not match the MSIX manifest.'

  if ($RebootAfterInstall) {
    $stateDirectory = Split-Path -Parent $StatePath
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    [pscustomobject]@{
      schemaVersion = 1
      phase = 'awaiting-reboot'
      packageFullName = $installed.PackageFullName
      publisherId = $installed.PublisherId
      version = [string]$installed.Version
    } | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    Write-Host "Reboot requested. Re-run with -ResumeAfterReboot after Windows starts; state is $StatePath."
    Restart-Computer -Force
    exit 0
  }
}

if ($UpgradePackage) {
  $resolvedUpgrade = (Resolve-Path -LiteralPath $UpgradePackage).Path
  $upgradeIdentity = Read-MsixPackageIdentity -PackagePath $resolvedUpgrade
  Require ($upgradeIdentity.Name -eq $packageIdentity.Name) "Upgrade MSIX has a different package name ($($upgradeIdentity.Name) vs $($packageIdentity.Name))."
  Require ($upgradeIdentity.Publisher -eq $packageIdentity.Publisher) 'Upgrade MSIX has a different publisher; Store/MSIX update identity would break.'
  Require ([version]$upgradeIdentity.Version -gt [version]$packageIdentity.Version) 'Upgrade MSIX version must be higher than the installed package.'
  Add-AppxPackage -Path $resolvedUpgrade -ForceApplicationShutdown
  $upgraded = Get-PennyWisePackage
  Require ($upgraded.Version -eq $upgradeIdentity.Version) 'The expected upgrade version is not registered.'
  Write-Host "Upgrade registered: $($upgraded.Version). Launch PennyWise and verify the existing company, documents, and backup configuration remain available."
}

if ($UninstallAtEnd) {
  $current = Get-PennyWisePackage
  Require ($null -ne $current) 'Cannot uninstall: PennyWise is no longer registered.'
  Remove-AppxPackage -Package $current.PackageFullName
  Require ($null -eq (Get-PennyWisePackage)) 'MSIX uninstall did not remove the current-user package registration.'
  Write-Host 'Uninstall registration passed. Manually verify the documented data-retention warning and recovery backup before deleting %LOCALAPPDATA%\\PennyWiseAccounting.'
}

Write-Host 'Lifecycle script completed. This does not prove first-launch, restore, or clean-machine behavior; record those manual observations in the D1 evidence report.'
