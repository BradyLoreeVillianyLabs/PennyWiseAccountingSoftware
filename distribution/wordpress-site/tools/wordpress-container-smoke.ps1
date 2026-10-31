[CmdletBinding()]
param(
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$siteRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$distRoot = Join-Path $siteRoot 'dist'
$pluginRoot = Join-Path $siteRoot 'clearledger-public-beta-site'
$mainPlugin = Join-Path $pluginRoot 'clearledger-public-beta-site.php'
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $distRoot 'WORDPRESS_RUNTIME_SMOKE.txt'
}
if (-not (Test-Path -LiteralPath $mainPlugin -PathType Leaf)) {
    throw "Plugin entry file is missing: $mainPlugin"
}
$pluginHeader = Get-Content -LiteralPath $mainPlugin -Raw
$versionMatch = [regex]::Match($pluginHeader, '(?m)^\s*\*\s*Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$')
if (-not $versionMatch.Success) {
    throw 'Unable to read a semantic Version header from the plugin entry file.'
}
$expectedVersion = $versionMatch.Groups[1].Value
$archive = Join-Path $distRoot "PennyWise-Accounting-Site-$expectedVersion.zip"
$dockerCommand = Get-Command docker -ErrorAction Stop

if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    throw "Build the WordPress ZIP before running the container smoke: $archive"
}

$runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
$networkName = "clwpqa-net-$runId"
$databaseName = "clwpqa-db-$runId"
$volumeName = "clwpqa-vol-$runId"
$databasePassword = 'ClWpQa_' + [guid]::NewGuid().ToString('N')
$adminPassword = 'ClWpAdmin_' + [guid]::NewGuid().ToString('N') + '!'
$wordpressImage = 'wordpress:cli-php8.3@sha256:2b5e9d4d3e51909dca1aaa4732e9f5e5bf0377c2114dbd8ff39f060bff202586'
$databaseImage = 'mariadb:11.4@sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7'
$checks = [System.Collections.Generic.List[string]]::new()

function Invoke-Docker {
    param(
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $output = & $dockerCommand.Source @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Docker command failed with exit code ${exitCode}: $($output -join ' ')"
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = @($output)
    }
}

function Invoke-Wp {
    param([string[]]$Arguments)

    $base = @(
        'run', '--rm',
        '--network', $networkName,
        '--user', '0:0',
        '--mount', "type=volume,source=$volumeName,target=/var/www/html",
        '--mount', "type=bind,source=$distRoot,target=/package,readonly",
        $wordpressImage,
        'php', '-d', 'memory_limit=512M', '/usr/local/bin/wp'
    )

    return Invoke-Docker -Arguments ($base + $Arguments + @('--allow-root'))
}

function Invoke-WpEval {
    param([string]$Code)

    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Code))
    return Invoke-Wp -Arguments @('eval', "eval(base64_decode('$encoded'));")
}

function Assert-Contains {
    param(
        [string]$Value,
        [string]$Expected,
        [string]$Description
    )

    if ($Value.IndexOf($Expected, [System.StringComparison]::Ordinal) -lt 0) {
        throw "$Description did not contain expected text: $Expected"
    }
    $script:checks.Add("PASS: $Description")
}

Invoke-Docker -Arguments @('network', 'create', $networkName) | Out-Null
Invoke-Docker -Arguments @('volume', 'create', $volumeName) | Out-Null

try {
    $databaseRun = @(
        'run', '-d',
        '--name', $databaseName,
        '--network', $networkName,
        '--env', "MARIADB_ROOT_PASSWORD=$databasePassword",
        '--env', 'MARIADB_DATABASE=wordpress',
        '--env', 'MARIADB_USER=wp',
        '--env', "MARIADB_PASSWORD=$databasePassword",
        '--health-cmd', 'healthcheck.sh --connect --innodb_initialized',
        '--health-interval', '2s',
        '--health-timeout', '5s',
        '--health-retries', '30',
        $databaseImage
    )
    Invoke-Docker -Arguments $databaseRun | Out-Null

    $healthy = $false
    for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
        $health = Invoke-Docker -Arguments @('inspect', '--format', '{{.State.Health.Status}}', $databaseName)
        $status = ($health.Output -join '').Trim()
        if ($status -eq 'healthy') {
            $healthy = $true
            break
        }
        if ($status -eq 'unhealthy') {
            throw 'Disposable MariaDB container became unhealthy.'
        }
        Start-Sleep -Seconds 1
    }
    if (-not $healthy) {
        throw 'Disposable MariaDB container did not become healthy within 45 seconds.'
    }
    $checks.Add('PASS: Disposable MariaDB reached healthy state.')

    Invoke-Wp -Arguments @('core', 'download', '--quiet') | Out-Null
    Invoke-Wp -Arguments @(
        'config', 'create',
        '--dbname=wordpress',
        '--dbuser=wp',
        "--dbpass=$databasePassword",
        "--dbhost=$databaseName",
        '--skip-check',
        '--quiet'
    ) | Out-Null
    Invoke-Wp -Arguments @(
        'core', 'install',
        '--url=https://clearledger-wordpress-qa.invalid',
        '--title=PennyWise WordPress QA',
        '--admin_user=clearledger_qa',
        "--admin_password=$adminPassword",
        '--admin_email=qa@clearledger-wordpress-qa.invalid',
        '--skip-email',
        '--quiet'
    ) | Out-Null

    $version = (Invoke-Wp -Arguments @('core', 'version')).Output -join ''
    $checks.Add("PASS: WordPress $($version.Trim()) installed in the disposable volume.")

    Invoke-Wp -Arguments @('plugin', 'install', "/package/PennyWise-Accounting-Site-$expectedVersion.zip", '--activate', '--quiet') | Out-Null
    $status = ((Invoke-Wp -Arguments @('plugin', 'get', 'clearledger-public-beta-site', '--field=status')).Output -join '').Trim()
    if ($status -ne 'active') {
        throw "Plugin did not activate. Reported status: $status"
    }
    $pluginVersion = ((Invoke-Wp -Arguments @('plugin', 'get', 'clearledger-public-beta-site', '--field=version')).Output -join '').Trim()
    if ($pluginVersion -ne $expectedVersion) {
        throw "Plugin archive reported unexpected version: $pluginVersion"
    }
    $checks.Add("PASS: Uploadable plugin $pluginVersion installed and activated in WordPress.")

    $landingCount = ((Invoke-Wp -Arguments @('post', 'list', '--post_type=page', '--name=clearledger-public-beta', '--post_status=draft', '--format=count')).Output -join '').Trim()
    if ($landingCount -ne '1') {
        throw "Expected one draft /clearledger-public-beta/ page after activation; found $landingCount."
    }
    $checks.Add('PASS: Activation created exactly one draft /clearledger-public-beta/ page.')

    $supportCount = ((Invoke-Wp -Arguments @('post', 'list', '--post_type=page', '--name=clearledger-support', '--post_status=draft', '--format=count')).Output -join '').Trim()
    if ($supportCount -ne '1') {
        throw "Expected one draft /clearledger-support/ page after activation; found $supportCount."
    }
    $checks.Add('PASS: Activation created exactly one draft /clearledger-support/ page.')

    $communityCount = ((Invoke-Wp -Arguments @('post', 'list', '--post_type=page', '--name=clearledger-community', '--post_status=draft', '--format=count')).Output -join '').Trim()
    if ($communityCount -ne '1') {
        throw "Expected one draft /clearledger-community/ page after activation; found $communityCount."
    }
    $checks.Add('PASS: Activation created exactly one draft /clearledger-community/ page.')

    $defaultHtml = (Invoke-WpEval -Code 'echo do_shortcode("[clearledger_beta]");').Output -join "`n"
    Assert-Contains -Value $defaultHtml -Expected 'Download not yet published' -Description 'Default shortcode fails closed'
    Assert-Contains -Value $defaultHtml -Expected 'Illustrative interface preview' -Description 'Default shortcode labels the illustrative preview'

    $sha = (('a1' * 32) -join '')
    $settingsCode = '$value = array("release_version" => "0.15.0-beta.1", "download_url" => "https://downloads.clearledger-wordpress-qa.invalid/PennyWise-Accounting-0.15.0-beta.1-x64.msix", "checksum_url" => "https://downloads.clearledger-wordpress-qa.invalid/PennyWise-Accounting-0.15.0-beta.1-x64.msix.sha256", "sha256" => "' + $sha + '"); update_option("clearledger_beta_site_options", $value);'
    Invoke-WpEval -Code $settingsCode | Out-Null

    $readyHtml = (Invoke-WpEval -Code 'echo do_shortcode("[clearledger_beta]");').Output -join "`n"
    Assert-Contains -Value $readyHtml -Expected 'downloads.clearledger-wordpress-qa.invalid' -Description 'Configured same-site HTTPS download renders'
    Assert-Contains -Value $readyHtml -Expected $sha -Description 'Configured checksum renders exactly'
    Assert-Contains -Value $readyHtml -Expected 'data-cl-copy-checksum' -Description 'Ready download exposes checksum-copy control'
    Assert-Contains -Value $readyHtml -Expected '.msix.sha256' -Description 'Ready download exposes the checksum file'

    $supportHtml = (Invoke-WpEval -Code 'echo do_shortcode("[clearledger_support]");').Output -join "`n"
    Assert-Contains -Value $supportHtml -Expected 'Report a suspected security issue privately' -Description 'Support shortcode includes private security guidance'
    Assert-Contains -Value $supportHtml -Expected 'Send a private security report' -Description 'Support shortcode renders native private security intake'
    Assert-Contains -Value $supportHtml -Expected 'not end-to-end encrypted' -Description 'Security intake states its storage boundary'
    Assert-Contains -Value $supportHtml -Expected 'security_acknowledged' -Description 'Security intake requires safe-data acknowledgement'
    if ($supportHtml -match '(?i)mailto:') {
        throw 'Support shortcode unexpectedly embedded an email route.'
    }
    $checks.Add('PASS: Support shortcode contains no mailto route.')
    Assert-Contains -Value $supportHtml -Expected 'Send a private product bug report' -Description 'Support shortcode renders private bug intake'
    Assert-Contains -Value $supportHtml -Expected 'clearledger_company_website' -Description 'Private bug intake includes a honeypot'

    $communityHtml = (Invoke-WpEval -Code 'echo do_shortcode("[clearledger_community]");').Output -join "`n"
    Assert-Contains -Value $communityHtml -Expected 'Submit feedback for moderation' -Description 'Community shortcode renders a pending-by-default form'
    Assert-Contains -Value $communityHtml -Expected 'Optional private contact' -Description 'Community shortcode labels private contact data'
    $contentTypeState = ((Invoke-WpEval -Code '$bug = get_post_type_object("clearledger_bug"); $security = get_post_type_object("clearledger_security"); $feedback = get_post_type_object("clearledger_feedback"); echo (!$bug->publicly_queryable && !$security->publicly_queryable && !$feedback->publicly_queryable && !$bug->show_in_rest && !$security->show_in_rest && !$feedback->show_in_rest && !$security->can_export) ? "private" : "exposed";').Output -join '').Trim()
    if ($contentTypeState -ne 'private') {
        throw 'Submission content types unexpectedly exposed public query or REST routes.'
    }
    $checks.Add('PASS: Bug, security, and feedback storage have no public query or REST enumeration surface; security records are excluded from ordinary exports.')

    Invoke-Wp -Arguments @('plugin', 'uninstall', 'clearledger-public-beta-site', '--deactivate', '--quiet') | Out-Null
    $uninstallState = ((Invoke-WpEval -Code 'echo false === get_option("clearledger_beta_site_options", false) ? "removed" : "present";').Output -join '').Trim()
    if ($uninstallState -ne 'removed') {
        throw 'Plugin uninstall did not remove its settings option.'
    }
    $checks.Add('PASS: Uninstall removed the plugin settings option.')

    $reportFull = [System.IO.Path]::GetFullPath($ReportPath)
    $reportParent = Split-Path -Parent $reportFull
    if (-not $reportFull.StartsWith(($siteRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write runtime-smoke evidence outside the WordPress package directory: $reportFull"
    }
    if (-not (Test-Path -LiteralPath $reportParent)) {
        New-Item -ItemType Directory -Path $reportParent -Force | Out-Null
    }

    $report = [System.Collections.Generic.List[string]]::new()
    $report.Add('PennyWise WordPress disposable runtime smoke')
    $report.Add("Generated: $([DateTimeOffset]::Now.ToString('u'))")
    $report.Add("WordPress CLI image: $wordpressImage")
    $report.Add("Database image: $databaseImage")
    $report.Add("Plugin version: $pluginVersion")
    $report.Add('')
    foreach ($check in $checks) {
        $report.Add($check)
    }
    Set-Content -LiteralPath $reportFull -Value $report.ToArray() -Encoding utf8
    Write-Output ($report.ToArray() -join "`n")
}
finally {
    Invoke-Docker -Arguments @('rm', '-f', $databaseName) -AllowFailure | Out-Null
    Invoke-Docker -Arguments @('volume', 'rm', '-f', $volumeName) -AllowFailure | Out-Null
    Invoke-Docker -Arguments @('network', 'rm', $networkName) -AllowFailure | Out-Null
}
