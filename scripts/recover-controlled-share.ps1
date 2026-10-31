[CmdletBinding()]
param(
    [ValidateSet(
        "clearledgerpreview",
        "clearledgeramanda",
        "clearledgercindi",
        "clearledgerbrady"
    )]
    [string] $Share = "clearledgerbrady",

    # This is deliberately supplied by the caller rather than persisted in a
    # workspace file. The recovery path rotates only the outer development
    # tunnel credential; it does not modify an application user or database.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]{20,64}$')]
    [string] $Password,

    [switch] $ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Reuse the guarded environment reader and the canonical controlled-share map.
# Dot-sourcing binds the helper script's parameters in this scope, so retain
# the requested target explicitly.
$requestedShare = $Share
$requestedValidateOnly = [bool] $ValidateOnly
. (Join-Path $PSScriptRoot "restart-controlled-shares.ps1") `
    -FunctionsOnly `
    -Share $requestedShare
$Share = $requestedShare
$ValidateOnly = $requestedValidateOnly

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$expected = $expectedShares[$Share]
if (-not $expected) {
    throw "Unknown controlled share '$Share'. No process was stopped."
}

$existingLauncher = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "node.exe" -and
            $_.CommandLine -match 'scripts/start-loclx-share\.mjs' -and
            $_.CommandLine -match ('--subdomain\s+(?:"{0}"|{0})(?:\s|$)' -f [regex]::Escape($Share))
        }
)
if ($existingLauncher.Count -gt 0) {
    throw "$Share already has a launcher. Use restart-controlled-shares.ps1 instead."
}

$apiListeners = @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $expected.ApiPort }
)
$webListeners = @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $expected.WebPort }
)
if ($webListeners.Count -gt 0) {
    throw "A process still owns web port $($expected.WebPort). No process was stopped."
}

if ($apiListeners.Count -gt 1) {
    throw "More than one process owns the target API port. No process was stopped."
}

$targetApi = $null
$sourceApi = $null
$sourceApiPort = 0
if ($apiListeners.Count -eq 1) {
    $targetApi = Get-CimInstance Win32_Process -Filter "ProcessId = $($apiListeners[0].OwningProcess)"
    if (
        -not $targetApi -or
        $targetApi.Name -ne "node.exe" -or
        [string]::IsNullOrWhiteSpace($targetApi.CommandLine) -or
        $targetApi.CommandLine -notmatch 'apps/api/src/index\.ts'
    ) {
        throw "The target API-port owner is not the expected ClearLedger API. No process was stopped."
    }
    $sourceApi = $targetApi
    $sourceApiPort = [int] $expected.ApiPort
}
else {
    # If a failed restart already removed the target API, a separate validated
    # controlled development API can supply the same database and encryption
    # configuration. It is read-only in this recovery path.
    foreach ($candidateSubdomain in $expectedShares.Keys) {
        if ($candidateSubdomain -eq $Share) {
            continue
        }
        $candidate = $expectedShares[$candidateSubdomain]
        $candidateListeners = @(
            Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                Where-Object { $_.LocalPort -eq $candidate.ApiPort }
        )
        if ($candidateListeners.Count -ne 1) {
            continue
        }
        $candidateApi = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $($candidateListeners[0].OwningProcess)"
        if (
            $candidateApi -and
            $candidateApi.Name -eq "node.exe" -and
            -not [string]::IsNullOrWhiteSpace($candidateApi.CommandLine) -and
            $candidateApi.CommandLine -match 'apps/api/src/index\.ts'
        ) {
            $sourceApi = $candidateApi
            $sourceApiPort = [int] $candidate.ApiPort
            break
        }
    }
    if (-not $sourceApi) {
        throw "No validated controlled development API is available for recovery. No process was stopped."
    }
}

$environment = @{}
foreach ($entry in [ClearLedgerProcessEnvironment]::Read([int]$sourceApi.ProcessId)) {
    $separator = $entry.IndexOf("=")
    if ($separator -gt 0) {
        $environment[$entry.Substring(0, $separator)] = $entry.Substring($separator + 1)
    }
}
$databaseUrl = [string] $environment["DATABASE_URL"]
$connectorSecret = [string] $environment["CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET"]
if ([string]::IsNullOrWhiteSpace($databaseUrl) -or $connectorSecret.Length -lt 32) {
    throw "The orphaned API is missing required development-share configuration. No process was stopped."
}

$membershipHeaders = @{
    "x-clearledger-user-email" = $expected.Email
    "x-clearledger-user-name" = $expected.Name
}
$membership = Invoke-RestMethod `
    -Uri "http://127.0.0.1:$sourceApiPort/v1/organizations" `
    -Headers $membershipHeaders `
    -TimeoutSec 10
$organizationIds = @(
    $membership.organizations |
        ForEach-Object { [string] $_.organizationId } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
)
if ($organizationIds.Count -ne 1) {
    throw "The recovery account does not resolve to exactly one organization. No process was stopped."
}

if ($ValidateOnly) {
    [pscustomobject]@{
        Share = $Share
        TargetApiPresent = ($null -ne $targetApi)
        ConfigurationSourceValidated = $true
        OrganizationResolved = $true
        BasicAuthWillRotate = $true
    } | Format-List
    return
}

# The process and port have both been validated above. Reclaim just the
# orphaned API tree, then create the standard launcher with the same database,
# encryption secret, user identity, organization, subdomain, and ports.
if ($targetApi) {
    & taskkill.exe /PID $targetApi.ProcessId /T /F 1>$null 2>$null
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $stillListening = @(
            Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                Where-Object { $_.LocalPort -eq $expected.ApiPort }
        )
        if ($stillListening.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if ($stillListening.Count -gt 0) {
        throw "The validated target API did not release port $($expected.ApiPort). No replacement launcher was started."
    }
}

$env:DATABASE_URL = $databaseUrl
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = $connectorSecret
if (-not [string]::IsNullOrWhiteSpace([string] $environment["Path"])) {
    $env:Path = [string] $environment["Path"]
}

$node = (Get-Command node -ErrorAction Stop).Source
$errorLog = Join-Path $env:TEMP "$Share-share-errors.log"
$arguments = @(
    "scripts/start-loclx-share.mjs",
    "--email", $expected.Email,
    "--name", $expected.Name,
    "--organization", $organizationIds[0],
    "--subdomain", $Share,
    "--reserved",
    "--username", $expected.Username,
    "--password", $Password,
    "--web-port", [string] $expected.WebPort,
    "--api-port", [string] $expected.ApiPort
)
$launcher = Start-Process `
    -FilePath $node `
    -ArgumentList $arguments `
    -WorkingDirectory $repository `
    -WindowStyle Hidden `
    -RedirectStandardOutput "NUL" `
    -RedirectStandardError $errorLog `
    -PassThru

$localDeadline = (Get-Date).AddSeconds(45)
$apiReady = $false
$webReady = $false
do {
    if (-not $apiReady) {
        try {
            $apiReady = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$($expected.ApiPort)/health").StatusCode -eq 200
        }
        catch {
            $apiReady = $false
        }
    }
    if (-not $webReady) {
        try {
            $webReady = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$($expected.WebPort)/").StatusCode -eq 200
        }
        catch {
            $webReady = $false
        }
    }
    if ($apiReady -and $webReady) {
        break
    }
    if ($launcher.HasExited) {
        throw "$Share launcher exited during recovery."
    }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $localDeadline)
if (-not ($apiReady -and $webReady)) {
    throw "$Share did not become locally healthy within 45 seconds."
}

$basicToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($expected.Username):$Password"))
$publicDeadline = (Get-Date).AddSeconds(45)
$publicReady = $false
do {
    try {
        $publicReady = (Invoke-WebRequest `
            -Uri "https://$Share.loclx.io/" `
            -Headers @{ Authorization = "Basic $basicToken" } `
            -UseBasicParsing `
            -TimeoutSec 8).StatusCode -eq 200
    }
    catch {
        $publicReady = $false
    }
    if ($publicReady) {
        break
    }
    if ($launcher.HasExited) {
        throw "$Share launcher exited before the public tunnel became ready."
    }
    Start-Sleep -Seconds 1
} while ((Get-Date) -lt $publicDeadline)
if (-not $publicReady) {
    throw "$Share is locally healthy, but its public tunnel did not become ready."
}

[pscustomobject]@{
    Share = $Share
    NewLauncherPid = $launcher.Id
    Api = "healthy"
    Web = "healthy"
    Public = "HTTP 200"
    BasicAuth = "rotated"
    Configuration = if ($targetApi) { "recovered from target API" } else { "recovered from validated peer API" }
} | Format-List
