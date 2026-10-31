[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "..\infrastructure\beta\pennywise-controlled-shares.json"),
    [string]$SecretsPath = (Join-Path $env:LOCALAPPDATA "PennyWiseAccounting\beta\pennywise-beta-secrets.clixml"),
    [string]$DatabaseUrl,
    [switch]$RotateAccessCredentials,
    [switch]$InstallSupervisorTask,
    [switch]$StartSupervisor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][System.Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function New-RandomToken {
    param([int]$ByteCount = 32)

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return ([Convert]::ToBase64String($bytes)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function ConvertTo-SecureValue {
    param([Parameter(Mandatory)][string]$Value)

    return ConvertTo-SecureString -String $Value -AsPlainText -Force
}

function Get-ShareSecret {
    param(
        [object]$Store,
        [Parameter(Mandatory)][string]$Key
    )

    if ($null -eq $Store -or $null -eq $Store.shares) { return $null }
    $property = $Store.shares.PSObject.Properties[$Key]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Assert-BetaConfig {
    param([Parameter(Mandatory)][object]$Config)

    if ($Config.schemaVersion -ne 1 -or $Config.environment -ne "controlled-beta") {
        throw "The PennyWise beta configuration is not a supported controlled-beta configuration."
    }
    if ($null -eq $Config.database -or $Config.database.expectedHost -ne "127.0.0.1") {
        throw "The beta configuration must target a loopback-only development database."
    }
    $keys = @{}
    $subdomains = @{}
    foreach ($share in @($Config.shares)) {
        foreach ($name in @("key", "displayName", "email", "organizationId", "subdomain", "username", "webPort", "apiPort")) {
            if ([string]::IsNullOrWhiteSpace([string]$share.$name)) {
                throw "The beta configuration is missing '$name' for one of its shares."
            }
        }
        $parsedOrganizationId = [Guid]::Empty
        if (-not [Guid]::TryParseExact([string]$share.organizationId, "D", [ref]$parsedOrganizationId)) {
            throw "The beta share '$($share.key)' has an invalid organization UUID."
        }
        if ($keys.ContainsKey([string]$share.key) -or $subdomains.ContainsKey([string]$share.subdomain)) {
            throw "Beta share keys and subdomains must be unique."
        }
        if ($share.subdomain -notmatch "^pennywise[a-z0-9-]+$") {
            throw "Only PennyWise-branded LocalXpose domains may be managed by this bootstrap."
        }
        $keys[[string]$share.key] = $true
        $subdomains[[string]$share.subdomain] = $true
    }
}

function Assert-DevelopmentDatabaseUrl {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][object]$Config
    )

    try {
        $uri = [Uri]$Value
    }
    catch {
        throw "The supplied database URL is invalid."
    }
    $expectedPort = [int]$Config.database.expectedPort
    $databaseName = $uri.AbsolutePath.Trim("/")
    if (
        $uri.Scheme -notin @("postgres", "postgresql") -or
        $uri.Host -notin @("127.0.0.1", "localhost", "::1") -or
        $uri.Port -ne $expectedPort -or
        $databaseName -ne [string]$Config.database.expectedDatabase
    ) {
        throw "The beta supervisor accepts only the configured loopback development database."
    }
}

function Ensure-ReservedDomain {
    param([Parameter(Mandatory)][string]$Subdomain)

    $loclx = Get-Command loclx.exe -ErrorAction Stop
    $domains = & $loclx.Source domain list 2>&1
    if ($LASTEXITCODE -ne 0) { throw "LocalXpose domain listing failed." }
    if ($domains -match ("(?im)\\b" + [regex]::Escape("$Subdomain.loclx.io") + "\\b")) { return }

    & $loclx.Source domain reserve --subdomain $Subdomain --region us
    if ($LASTEXITCODE -ne 0) { throw "Could not reserve $Subdomain.loclx.io." }
}

function Ensure-PennyWiseBetaEntryPoint {
    param([Parameter(Mandatory)][string]$Repository)

    $bundleDirectory = Split-Path -Parent $Repository
    $workspaceDirectory = Split-Path -Parent $bundleDirectory
    $entryPoint = Join-Path $workspaceDirectory "PennyWise-Accounting-Beta"
    if (Test-Path -LiteralPath $entryPoint) {
        $item = Get-Item -LiteralPath $entryPoint -Force
        if ($item.LinkType -ne "Junction") {
            throw "$entryPoint already exists and is not the PennyWise beta junction."
        }
        $target = @($item.Target)[0]
        if ([string]::IsNullOrWhiteSpace([string]$target)) {
            throw "$entryPoint has no readable junction target."
        }
        $resolvedTarget = (Resolve-Path -LiteralPath $target -ErrorAction Stop).Path.TrimEnd("\\")
        if ($resolvedTarget -ne $Repository.TrimEnd("\\")) {
            throw "$entryPoint does not point to the active PennyWise beta source."
        }
        return $entryPoint
    }
    New-Item -ItemType Junction -Path $entryPoint -Target $Repository | Out-Null
    return $entryPoint
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..") -ErrorAction Stop).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
Assert-BetaConfig -Config $config

$secretsDirectory = Split-Path -Parent $SecretsPath
New-Item -ItemType Directory -Path $secretsDirectory -Force | Out-Null
$existingStore = if (Test-Path -LiteralPath $SecretsPath) {
    Import-Clixml -LiteralPath $SecretsPath
}
else {
    $null
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    if ($null -ne $existingStore -and -not [string]::IsNullOrWhiteSpace([string]$existingStore.databaseUrl)) {
        $DatabaseUrl = [string]$existingStore.databaseUrl
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
        $DatabaseUrl = $env:DATABASE_URL
    }
    else {
        throw "Provide -DatabaseUrl on the first setup; it is saved encrypted for the signed-in Windows user."
    }
}
Assert-DevelopmentDatabaseUrl -Value $DatabaseUrl -Config $config

$existingConnectorSecret = if ($null -ne $existingStore) {
    $existingStore.connectorCredentialEncryptionSecret
}
else {
    $null
}
$connectorSecret = if ($null -ne $existingConnectorSecret) {
    $existingConnectorSecret
}
else {
    ConvertTo-SecureValue -Value (New-RandomToken)
}
if ((ConvertFrom-SecureValue -Value $connectorSecret).Length -lt 32) {
    throw "The stored connector credential encryption key is too short. Rotate connector credentials before replacing it."
}

$shareSecrets = [ordered]@{}
foreach ($share in @($config.shares)) {
    $existingShare = Get-ShareSecret -Store $existingStore -Key ([string]$share.key)
    $password = if (-not $RotateAccessCredentials -and $null -ne $existingShare -and $null -ne $existingShare.accessPassword) {
        $existingShare.accessPassword
    }
    else {
        ConvertTo-SecureValue -Value (New-RandomToken)
    }
    if ((ConvertFrom-SecureValue -Value $password).Length -lt 20) {
        throw "The stored access password for $($share.key) is too short."
    }
    $shareSecrets[[string]$share.key] = [pscustomobject]@{ accessPassword = $password }
}

$store = [pscustomobject]@{
    schemaVersion = 1
    databaseUrl = $DatabaseUrl
    connectorCredentialEncryptionSecret = $connectorSecret
    shares = [pscustomobject]$shareSecrets
}
$temporarySecretsPath = "$SecretsPath.$PID.tmp"
try {
    $store | Export-Clixml -LiteralPath $temporarySecretsPath
    Move-Item -LiteralPath $temporarySecretsPath -Destination $SecretsPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporarySecretsPath) {
        Remove-Item -LiteralPath $temporarySecretsPath -Force
    }
}

foreach ($share in @($config.shares)) {
    Ensure-ReservedDomain -Subdomain ([string]$share.subdomain)
}
$entryPoint = Ensure-PennyWiseBetaEntryPoint -Repository $repository

if ($StartSupervisor -and -not $InstallSupervisorTask) {
    throw "-StartSupervisor requires -InstallSupervisorTask so the persistent task owns the share processes."
}
if ($InstallSupervisorTask) {
    & (Join-Path $PSScriptRoot "install-pennywise-beta-supervisor.ps1") `
        -ConfigPath $ConfigPath `
        -SecretsPath $SecretsPath `
        -StartNow:$StartSupervisor
}

Write-Output "PennyWise controlled beta access is initialized. Use $entryPoint as the stable branded source entry point; passwords and connector keys are encrypted for this Windows user outside the repository."
