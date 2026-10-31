[CmdletBinding()]
param(
    [string]$SiteRootOverride
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$siteRoot = if ([string]::IsNullOrWhiteSpace($SiteRootOverride)) {
    [System.IO.Path]::GetFullPath($PSScriptRoot)
}
else {
    [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $SiteRootOverride).Path)
}
$pluginRoot = Join-Path $siteRoot 'clearledger-public-beta-site'
$distRoot = Join-Path $siteRoot 'dist'
$validator = Join-Path $siteRoot 'tools\validate-wordpress-package.ps1'
$mainPlugin = Join-Path $pluginRoot 'clearledger-public-beta-site.php'

function Invoke-PackageValidator {
    param(
        [string]$Plugin,
        [string]$Archive,
        [string]$Report
    )

    $validatorBlock = [scriptblock]::Create([System.IO.File]::ReadAllText($validator))
    $arguments = @{
        PluginRoot     = $Plugin
        UsePhpContainer = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($Archive)) {
        $arguments['ArchivePath'] = $Archive
    }
    if (-not [string]::IsNullOrWhiteSpace($Report)) {
        $arguments['ReportPath'] = $Report
    }
    & $validatorBlock @arguments
}

if (-not (Test-Path -LiteralPath $mainPlugin -PathType Leaf)) {
    throw "Plugin entry file is missing: $mainPlugin"
}

$header = Get-Content -LiteralPath $mainPlugin -Raw
$versionMatch = [regex]::Match($header, '(?m)^\s*\*\s*Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$')
if (-not $versionMatch.Success) {
    throw 'Unable to read a semantic Version header from the plugin entry file.'
}
$version = $versionMatch.Groups[1].Value

if (-not (Test-Path -LiteralPath $distRoot)) {
    New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
}

$archivePath = Join-Path $distRoot "PennyWise-Accounting-Site-$version.zip"
$checksumPath = Join-Path $distRoot 'SHA256SUMS.txt'
$reportPath = Join-Path $distRoot 'VALIDATION.txt'
$runtimeSmokePath = Join-Path $distRoot 'WORDPRESS_RUNTIME_SMOKE.txt'

$safePrefix = $siteRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
foreach ($target in @($archivePath, $checksumPath, $reportPath, $runtimeSmokePath)) {
    $resolvedTarget = [System.IO.Path]::GetFullPath($target)
    if (-not $resolvedTarget.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write outside the WordPress package directory: $resolvedTarget"
    }
}

Invoke-PackageValidator -Plugin $pluginRoot

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
if (Test-Path -LiteralPath $runtimeSmokePath) {
    Remove-Item -LiteralPath $runtimeSmokePath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in @(Get-ChildItem -LiteralPath $pluginRoot -File -Recurse | Sort-Object FullName)) {
        $relativePath = $file.FullName.Substring($pluginRoot.Length + 1).Replace('\', '/')
        $entryName = "clearledger-public-beta-site/$relativePath"
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $file.FullName,
            $entryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
}
finally {
    $zip.Dispose()
}

Invoke-PackageValidator -Plugin $pluginRoot -Archive $archivePath -Report $reportPath

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumLine = "$hash  $([System.IO.Path]::GetFileName($archivePath))"
Set-Content -LiteralPath $checksumPath -Value $checksumLine -Encoding ascii

Write-Output "Built: $archivePath"
Write-Output "SHA-256: $hash"
Write-Output "Validation: $reportPath"
