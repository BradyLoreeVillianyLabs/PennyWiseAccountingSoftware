[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PluginRoot,

    [string]$ArchivePath,

    [string]$ReportPath,

    [switch]$UsePhpContainer
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedPluginRoot = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PluginRoot).Path)
$mainPluginPath = Join-Path $resolvedPluginRoot 'clearledger-public-beta-site.php'
$results = [System.Collections.Generic.List[object]]::new()
$failures = [System.Collections.Generic.List[string]]::new()

function Add-ValidationResult {
    param(
        [string]$Check,
        [ValidateSet('PASS', 'WARN', 'FAIL')]
        [string]$Status,
        [string]$Detail
    )

    $results.Add([pscustomobject]@{
            Check  = $Check
            Status = $Status
            Detail = $Detail
        })

    if ($Status -eq 'FAIL') {
        $failures.Add("${Check}: ${Detail}")
    }
}

function Test-PathWithinRoot {
    param(
        [string]$Candidate,
        [string]$Root
    )

    $candidateFull = [System.IO.Path]::GetFullPath($Candidate)
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    return $candidateFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
}

$requiredFiles = @(
    'clearledger-public-beta-site.php',
    'uninstall.php',
    'index.php',
    'readme.txt',
    'includes\class-clearledger-beta-settings.php',
    'includes\class-clearledger-beta-page.php',
    'includes\class-clearledger-beta-submissions.php',
    'assets\css\public-beta.css',
    'assets\js\admin.js',
    'assets\js\public-beta.js'
)

$missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $resolvedPluginRoot $_) -PathType Leaf) })
if ($missingFiles.Count -eq 0) {
    Add-ValidationResult 'Required package files' 'PASS' "All $($requiredFiles.Count) required files are present."
}
else {
    Add-ValidationResult 'Required package files' 'FAIL' ('Missing: ' + ($missingFiles -join ', '))
}

$allFiles = @(Get-ChildItem -LiteralPath $resolvedPluginRoot -File -Recurse)
$unexpected = @($allFiles | Where-Object { $_.Extension.ToLowerInvariant() -notin @('.php', '.css', '.js', '.txt') })
if ($unexpected.Count -eq 0) {
    Add-ValidationResult 'Bounded file types' 'PASS' 'The plugin contains only PHP, CSS, JavaScript, and text files.'
}
else {
    Add-ValidationResult 'Bounded file types' 'FAIL' ('Unexpected files: ' + (($unexpected.FullName | ForEach-Object { $_.Substring($resolvedPluginRoot.Length + 1) }) -join ', '))
}

$combinedText = ($allFiles | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
$forbiddenPatterns = [ordered]@{
    'Insecure HTTP URL'      = '(?i)http://'
    'Analytics or pixels'    = '(?i)(google-analytics|googletagmanager|gtag\s*\(|facebook\s+pixel|fbq\s*\(|mixpanel|segment\.com|hotjar)'
    'Outbound browser calls' = '(?i)(navigator\.sendBeacon|XMLHttpRequest|\bfetch\s*\()'
    'Remote CSS import'      = '(?i)@import\s+(?:url\s*\()?[''\"]?https?://'
    'Decorative gradient'    = '(?i)(linear|radial|conic)-gradient\s*\('
    'High-risk PHP execution'= '(?i)\b(eval|shell_exec|passthru|proc_open|popen)\s*\('
    'Probable API secret'    = '(?i)(sk-[a-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|whsec_[A-Za-z0-9]{20,}|cl_live_[A-Za-z0-9]{20,})'
    'Embedded email route'   = '(?i)mailto:'
}

foreach ($entry in $forbiddenPatterns.GetEnumerator()) {
    if ($combinedText -match $entry.Value) {
        Add-ValidationResult $entry.Key 'FAIL' 'A forbidden token or implementation pattern was found.'
    }
    else {
        Add-ValidationResult $entry.Key 'PASS' 'No match found.'
    }
}

$mainPhp = Get-Content -LiteralPath (Join-Path $resolvedPluginRoot 'clearledger-public-beta-site.php') -Raw
$settingsPhp = Get-Content -LiteralPath (Join-Path $resolvedPluginRoot 'includes\class-clearledger-beta-settings.php') -Raw
$pagePhp = Get-Content -LiteralPath (Join-Path $resolvedPluginRoot 'includes\class-clearledger-beta-page.php') -Raw
$submissionsPhp = Get-Content -LiteralPath (Join-Path $resolvedPluginRoot 'includes\class-clearledger-beta-submissions.php') -Raw

$securityMarkers = [ordered]@{
    'ABSPATH guards'            = 'defined\s*\(\s*[''\"]ABSPATH[''\"]\s*\)'
    'Capability gate'           = 'current_user_can\s*\(\s*[''\"]manage_options[''\"]\s*\)'
    'Settings nonce integration'= 'settings_fields\s*\(\s*[''\"]clearledger_beta_site[''\"]\s*\)'
    'HTTPS sanitization'        = 'sanitize_https_url'
    'Checksum validation'       = '\^\[a-f0-9\]\{64\}\$'
    'Output escaping'           = 'esc_(html|attr|url)\s*\('
    'Shortcode registration'    = 'add_shortcode\s*\(\s*[''\"]clearledger_beta[''\"]'
    'Support shortcode'         = 'add_shortcode\s*\(\s*[''\"]clearledger_support[''\"]'
    'Stable support route'      = '[''\"]clearledger-support[''\"]'
    'Native security storage'  = 'clearledger_security'
    'Native security form'     = 'clearledger_form[''"]\s+value=[''"]security[''"]'
    'Same-site release gate'    = 'is_same_site_https_url'
    'Checksum sibling gate'     = 'checksum_url'
    'Private bug storage'       = 'clearledger_bug'
    'Pending feedback storage'  = 'clearledger_feedback'
    'Form nonce verification'   = 'wp_verify_nonce'
    'Submission honeypot'       = 'clearledger_company_website'
    'Hashed IP rate limit'      = 'hash_hmac\s*\('
    'File submission rejection'= '!\s*empty\s*\(\s*\$_FILES\s*\)'
    'Bounded request size'      = 'MAXIMUM_REQUEST_BYTES'
    'No public enumeration'     = '[''"]publicly_queryable[''"]\s*=>\s*false'
    'No ordinary export'        = '[''"]can_export[''"]\s*=>\s*false'
    'Moderator workflow'        = 'clearledger_moderation_status'
}
$securitySurface = $mainPhp + "`n" + $settingsPhp + "`n" + $pagePhp + "`n" + $submissionsPhp
foreach ($entry in $securityMarkers.GetEnumerator()) {
    if ($securitySurface -match $entry.Value) {
        Add-ValidationResult $entry.Key 'PASS' 'Required implementation marker is present.'
    }
    else {
        Add-ValidationResult $entry.Key 'FAIL' 'Required implementation marker is missing.'
    }
}

$publicStatusMarkers = [ordered]@{
    'Public live-service boundary'       = 'The public beta does not offer live bank feeds or a released statutory payroll service.'
    'Public direct-deposit boundary'     = 'Direct deposit, CRA filing or remittance, ROE/T4 submission, and unsupported jurisdictional payroll remain unavailable.'
    'Public marketplace-tax boundary'    = 'does not automatically decide what Etsy or another marketplace has remitted'
    'Public commerce non-posting boundary'= 'marketplace tax-remittance decisions, and live ledger posting are not included.'
}
foreach ($entry in $publicStatusMarkers.GetEnumerator()) {
    if ($pagePhp.IndexOf([string]$entry.Value, [System.StringComparison]::Ordinal) -ge 0) {
        Add-ValidationResult $entry.Key 'PASS' 'Required public-beta status boundary is present.'
    }
    else {
        Add-ValidationResult $entry.Key 'FAIL' 'Required public-beta status boundary is missing.'
    }
}

$capabilityItemCount = [regex]::Matches($pagePhp, 'data-cl-capability-item').Count
$capabilityAnchorCount = [regex]::Matches($pagePhp, '<a\s+href="#[^"]+"\s+data-cl-capability-item>').Count
if ($capabilityItemCount -ge 10 -and $capabilityItemCount -eq $capabilityAnchorCount) {
    Add-ValidationResult 'Capability search result links' 'PASS' "All $capabilityItemCount searchable capability results are in-page links."
}
else {
    Add-ValidationResult 'Capability search result links' 'FAIL' "Expected linked capability results, found $capabilityAnchorCount anchors for $capabilityItemCount items."
}

$phpCommand = Get-Command php -ErrorAction SilentlyContinue
$smokePath = Join-Path (Split-Path -Parent $resolvedPluginRoot) 'tools\wordpress-stub-smoke.php'
if (-not (Test-Path -LiteralPath $smokePath -PathType Leaf)) {
    Add-ValidationResult 'WordPress stub smoke' 'FAIL' "Smoke harness is missing: $smokePath"
}
if ($null -eq $phpCommand) {
    if ($UsePhpContainer) {
        $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
        if ($null -eq $dockerCommand) {
            Add-ValidationResult 'PHP syntax' 'FAIL' 'Neither PHP CLI nor Docker is available for required PHP syntax validation.'
        }
        else {
            $phpImage = 'php:8.3-cli-alpine@sha256:afdf8b1fee58486ccc0dab5f30f634b86873d56dac985f71ba217945647c05ad'
            $mount = "type=bind,source=$resolvedPluginRoot,target=/src,readonly"
            $containerOutput = & $dockerCommand.Source run --rm --mount $mount $phpImage sh -lc 'find /src -name "*.php" -print0 | xargs -0 -n1 php -l' 2>&1
            if ($LASTEXITCODE -eq 0) {
                Add-ValidationResult 'PHP syntax' 'PASS' "Every PHP file passed php -l in pinned container $phpImage."
            }
            else {
                Add-ValidationResult 'PHP syntax' 'FAIL' ($containerOutput -join ' ')
            }

            if (Test-Path -LiteralPath $smokePath -PathType Leaf) {
                $smokeRoot = Split-Path -Parent $smokePath
                $smokeMount = "type=bind,source=$smokeRoot,target=/tests,readonly"
                $smokeOutput = & $dockerCommand.Source run --rm --mount $mount --mount $smokeMount $phpImage php /tests/wordpress-stub-smoke.php /src/clearledger-public-beta-site.php 2>&1
                if ($LASTEXITCODE -eq 0) {
                    Add-ValidationResult 'WordPress stub smoke' 'PASS' ($smokeOutput -join ' ')
                }
                else {
                    Add-ValidationResult 'WordPress stub smoke' 'FAIL' ($smokeOutput -join ' ')
                }
            }
        }
    }
    else {
        Add-ValidationResult 'PHP syntax' 'WARN' 'PHP CLI is not installed on the host; rerun with -UsePhpContainer before publishing.'
    }
}
else {
    $phpFailures = [System.Collections.Generic.List[string]]::new()
    foreach ($file in @($allFiles | Where-Object { $_.Extension -eq '.php' })) {
        $output = & $phpCommand.Source -l $file.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            $phpFailures.Add("$($file.Name): $($output -join ' ')")
        }
    }

    if ($phpFailures.Count -eq 0) {
        Add-ValidationResult 'PHP syntax' 'PASS' 'Every PHP file passed php -l.'
    }
    else {
        Add-ValidationResult 'PHP syntax' 'FAIL' ($phpFailures -join '; ')
    }

    if (Test-Path -LiteralPath $smokePath -PathType Leaf) {
        $smokeOutput = & $phpCommand.Source $smokePath $mainPluginPath 2>&1
        if ($LASTEXITCODE -eq 0) {
            Add-ValidationResult 'WordPress stub smoke' 'PASS' ($smokeOutput -join ' ')
        }
        else {
            Add-ValidationResult 'WordPress stub smoke' 'FAIL' ($smokeOutput -join ' ')
        }
    }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    Add-ValidationResult 'JavaScript syntax' 'WARN' 'Node.js is unavailable; public-beta.js was not parsed.'
}
else {
    $jsPath = Join-Path $resolvedPluginRoot 'assets\js\public-beta.js'
    $adminJsPath = Join-Path $resolvedPluginRoot 'assets\js\admin.js'
    $nodeOutput = @(& $nodeCommand.Source --check $jsPath 2>&1)
    $publicJsExitCode = $LASTEXITCODE
    $nodeOutput += @(& $nodeCommand.Source --check $adminJsPath 2>&1)
    $adminJsExitCode = $LASTEXITCODE
    if ($publicJsExitCode -eq 0 -and $adminJsExitCode -eq 0) {
        Add-ValidationResult 'JavaScript syntax' 'PASS' 'public-beta.js and admin.js passed node --check.'
    }
    else {
        Add-ValidationResult 'JavaScript syntax' 'FAIL' ($nodeOutput -join ' ')
    }

    $jsSmokePath = Join-Path (Split-Path -Parent $resolvedPluginRoot) 'tools\javascript-smoke.mjs'
    if (-not (Test-Path -LiteralPath $jsSmokePath -PathType Leaf)) {
        Add-ValidationResult 'JavaScript behavior smoke' 'FAIL' "Smoke harness is missing: $jsSmokePath"
    }
    else {
        $jsSmokeOutput = & $nodeCommand.Source $jsSmokePath $jsPath 2>&1
        if ($LASTEXITCODE -eq 0) {
            Add-ValidationResult 'JavaScript behavior smoke' 'PASS' ($jsSmokeOutput -join ' ')
        }
        else {
            Add-ValidationResult 'JavaScript behavior smoke' 'FAIL' ($jsSmokeOutput -join ' ')
        }
    }
}

if ($ArchivePath) {
    $resolvedArchive = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ArchivePath).Path)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedArchive)
    try {
        $entries = @($zip.Entries)
        $entryNames = @($entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        $unsafeEntries = @($entries | Where-Object {
                $_.FullName.StartsWith('/') -or
                $_.FullName.StartsWith('\') -or
                $_.FullName -match '(^|[\\/])\.\.([\\/]|$)' -or
                $_.FullName -match '^[A-Za-z]:'
            })

        if ($unsafeEntries.Count -eq 0) {
            Add-ValidationResult 'ZIP path safety' 'PASS' "All $($entries.Count) archive paths are relative and traversal-free."
        }
        else {
            Add-ValidationResult 'ZIP path safety' 'FAIL' ('Unsafe paths: ' + (($unsafeEntries.FullName) -join ', '))
        }

        $topLevels = @($entries | ForEach-Object { ($_.FullName -split '[\\/]')[0] } | Where-Object { $_ } | Sort-Object -Unique)
        if ($topLevels.Count -eq 1 -and $topLevels[0] -eq 'clearledger-public-beta-site') {
            Add-ValidationResult 'ZIP plugin root' 'PASS' 'The archive has exactly one correctly named top-level plugin directory.'
        }
        else {
            Add-ValidationResult 'ZIP plugin root' 'FAIL' ('Unexpected top-level entries: ' + ($topLevels -join ', '))
        }

        $archivedRequired = @($requiredFiles | Where-Object {
                $expected = ('clearledger-public-beta-site/' + ($_ -replace '\\', '/'))
                -not ($entryNames -contains $expected)
            })
        if ($archivedRequired.Count -eq 0) {
            Add-ValidationResult 'ZIP required files' 'PASS' 'Every required source file is present in the archive.'
        }
        else {
            Add-ValidationResult 'ZIP required files' 'FAIL' ('Missing from ZIP: ' + ($archivedRequired -join ', '))
        }

        $sourceEntryHashes = @{}
        foreach ($sourceFile in $allFiles) {
            $relativeSourcePath = $sourceFile.FullName.Substring($resolvedPluginRoot.Length + 1).Replace('\', '/')
            $sourceEntryName = 'clearledger-public-beta-site/' + $relativeSourcePath
            $sourceEntryHashes[$sourceEntryName] = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }

        $archiveFileEntries = @($entries | Where-Object { -not $_.FullName.EndsWith('/') })
        $archiveEntryLookup = @{}
        foreach ($archiveEntry in $archiveFileEntries) {
            $archiveEntryLookup[$archiveEntry.FullName -replace '\\', '/'] = $archiveEntry
        }

        $parityFailures = [System.Collections.Generic.List[string]]::new()
        foreach ($sourceEntryName in $sourceEntryHashes.Keys) {
            if (-not $archiveEntryLookup.ContainsKey($sourceEntryName)) {
                $parityFailures.Add("missing $sourceEntryName")
                continue
            }

            $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
            $entryStream = $archiveEntryLookup[$sourceEntryName].Open()
            try {
                $archiveEntryHash = (($hashAlgorithm.ComputeHash($entryStream) | ForEach-Object { $_.ToString('x2') }) -join '')
            }
            finally {
                $entryStream.Dispose()
                $hashAlgorithm.Dispose()
            }

            if ($archiveEntryHash -ne $sourceEntryHashes[$sourceEntryName]) {
                $parityFailures.Add("content differs $sourceEntryName")
            }
        }

        foreach ($archiveEntryName in $archiveEntryLookup.Keys) {
            if (-not $sourceEntryHashes.ContainsKey($archiveEntryName)) {
                $parityFailures.Add("unexpected $archiveEntryName")
            }
        }

        if ($parityFailures.Count -eq 0) {
            Add-ValidationResult 'ZIP source parity' 'PASS' "All $($sourceEntryHashes.Count) archived files exactly match the reviewed plugin source."
        }
        else {
            Add-ValidationResult 'ZIP source parity' 'FAIL' (($parityFailures | Select-Object -First 8) -join '; ')
        }
    }
    finally {
        $zip.Dispose()
    }

    $archiveHash = (Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    Add-ValidationResult 'ZIP SHA-256' 'PASS' $archiveHash
}

$report = $results | Format-Table -AutoSize -Wrap | Out-String -Width 240
$report = "ClearLedger WordPress package validation`nGenerated: $([DateTimeOffset]::Now.ToString('u'))`n`n$report"

if ($ReportPath) {
    $reportFull = [System.IO.Path]::GetFullPath($ReportPath)
    $reportParent = Split-Path -Parent $reportFull
    if (-not (Test-Path -LiteralPath $reportParent)) {
        New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
    }
    Set-Content -LiteralPath $reportFull -Value $report -Encoding utf8
}

Write-Output $report

if ($failures.Count -gt 0) {
    throw "WordPress package validation failed:`n$($failures -join "`n")"
}
