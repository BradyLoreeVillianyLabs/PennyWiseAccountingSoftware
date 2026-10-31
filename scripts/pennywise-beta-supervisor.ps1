[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "..\infrastructure\beta\pennywise-controlled-shares.json"),
    [string]$SecretsPath = (Join-Path $env:LOCALAPPDATA "PennyWiseAccounting\beta\pennywise-beta-secrets.clixml")
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

function Get-CommandLineArgument {
    param(
        [Parameter(Mandatory)][string]$CommandLine,
        [Parameter(Mandatory)][string]$Name
    )

    $pattern = "--" + [regex]::Escape($Name) + '\s+(?:"(?<value>[^"]+)"|(?<value>\S+))'
    $match = [regex]::Match($CommandLine, $pattern)
    if ($match.Success) { return $match.Groups["value"].Value }
    return $null
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
    $ports = @{}
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
        if ($share.subdomain -notmatch "^pennywise[a-z0-9-]+$") {
            throw "Only PennyWise-branded LocalXpose domains may be managed by this supervisor."
        }
        if ($keys.ContainsKey([string]$share.key)) { throw "Beta share keys must be unique." }
        foreach ($port in @([int]$share.webPort, [int]$share.apiPort)) {
            if ($port -lt 1024 -or $port -gt 65535 -or $ports.ContainsKey($port)) {
                throw "Every beta share web/API port must be unique and non-privileged."
            }
            $ports[$port] = $true
        }
        $keys[[string]$share.key] = $true
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
        throw "The stored beta database URL is invalid."
    }
    if (
        $uri.Scheme -notin @("postgres", "postgresql") -or
        $uri.Host -notin @("127.0.0.1", "localhost", "::1") -or
        $uri.Port -ne [int]$Config.database.expectedPort -or
        $uri.AbsolutePath.Trim("/") -ne [string]$Config.database.expectedDatabase
    ) {
        throw "The beta supervisor refuses to start against a non-loopback or unexpected database."
    }
}

function Get-ShareSecret {
    param(
        [Parameter(Mandatory)][object]$Store,
        [Parameter(Mandatory)][string]$Key
    )

    $property = $Store.shares.PSObject.Properties[$Key]
    if ($null -eq $property -or $null -eq $property.Value.accessPassword) {
        throw "The encrypted access secret for $Key is missing. Run initialize-pennywise-beta-access.ps1 again."
    }
    return $property.Value.accessPassword
}

function Stop-ManagedShare {
    param([Parameter(Mandatory)][string]$Subdomain)

    $launchers = @(
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.Name -eq "node.exe" -and
                $_.CommandLine -match "scripts/start-loclx-share\\.mjs" -and
                (Get-CommandLineArgument -CommandLine $_.CommandLine -Name "subdomain") -eq $Subdomain
            }
    )
    foreach ($launcher in $launchers) {
        & taskkill.exe /pid $launcher.ProcessId /t /f *> $null
    }
}

function Start-ManagedShare {
    param(
        [Parameter(Mandatory)][object]$Share,
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string]$DatabaseUrl,
        [Parameter(Mandatory)][string]$ConnectorSecret,
        [Parameter(Mandatory)][string]$AccessPassword,
        [Parameter(Mandatory)][string]$LogDirectory,
        [Parameter(Mandatory)][string]$NodePath
    )

    Stop-ManagedShare -Subdomain ([string]$Share.subdomain)
    $environment = [ordered]@{
        NODE_ENV = "development"
        DATABASE_URL = $DatabaseUrl
        CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = $ConnectorSecret
        SHARE_ACCESS_USERNAME = [string]$Share.username
        SHARE_ACCESS_PASSWORD = $AccessPassword
        STRIPE_MODE = ""
        STRIPE_SECRET_KEY = ""
        STRIPE_WEBHOOK_SECRET = ""
    }
    $previous = @{}
    foreach ($name in $environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
        Set-Item -Path "Env:$name" -Value ([string]$environment[$name])
    }
    try {
        $arguments = @(
            "scripts/start-loclx-share.mjs",
            "--email", [string]$Share.email,
            "--name", [string]$Share.displayName,
            "--organization", [string]$Share.organizationId,
            "--subdomain", [string]$Share.subdomain,
            "--reserved",
            "--username", [string]$Share.username,
            "--web-port", [string]$Share.webPort,
            "--api-port", [string]$Share.apiPort
        )
        return Start-Process `
            -FilePath $NodePath `
            -ArgumentList $arguments `
            -WorkingDirectory $Repository `
            -RedirectStandardOutput (Join-Path $LogDirectory "$($Share.key).out.log") `
            -RedirectStandardError (Join-Path $LogDirectory "$($Share.key).err.log") `
            -WindowStyle Hidden `
            -PassThru
    }
    finally {
        foreach ($name in $environment.Keys) {
            if ($null -eq $previous[$name]) {
                Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item -Path "Env:$name" -Value $previous[$name]
            }
        }
    }
}

function Get-AccessHeader {
    param(
        [Parameter(Mandatory)][object]$Share,
        [Parameter(Mandatory)][string]$AccessPassword
    )

    $pair = "{0}:{1}" -f [string]$Share.username, $AccessPassword
    return "Basic " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
}

function Test-ManagedShare {
    param(
        [Parameter(Mandatory)][object]$Share,
        [Parameter(Mandatory)][string]$AccessPassword
    )

    try {
        $headers = @{ Authorization = (Get-AccessHeader -Share $Share -AccessPassword $AccessPassword) }
        $local = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$($Share.webPort)/" `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 10
        if ($local.StatusCode -ne 200) { return $false }
        $remote = Invoke-WebRequest `
            -Uri "https://$($Share.subdomain).loclx.io/" `
            -Headers $headers `
            -UseBasicParsing `
            -TimeoutSec 15
        return $remote.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Wait-ForManagedShare {
    param(
        [Parameter(Mandatory)][object]$Share,
        [Parameter(Mandatory)][string]$AccessPassword
    )

    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (Test-ManagedShare -Share $Share -AccessPassword $AccessPassword) { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for PennyWise beta share $($Share.subdomain).loclx.io."
}

function Test-ProcessRunning {
    param($Process)

    if ($null -eq $Process -or $Process.HasExited) { return $false }
    try {
        Get-Process -Id $Process.Id -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$SecretsPath = (Resolve-Path -LiteralPath $SecretsPath -ErrorAction Stop).Path
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..") -ErrorAction Stop).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$secrets = Import-Clixml -LiteralPath $SecretsPath
Assert-BetaConfig -Config $config
Assert-DevelopmentDatabaseUrl -Value ([string]$secrets.databaseUrl) -Config $config

$connectorSecret = ConvertFrom-SecureValue -Value $secrets.connectorCredentialEncryptionSecret
if ($connectorSecret.Length -lt 32) { throw "The stored connector credential encryption key is too short." }
$accessPasswords = @{}
foreach ($share in @($config.shares)) {
    $accessPassword = ConvertFrom-SecureValue -Value (Get-ShareSecret -Store $secrets -Key ([string]$share.key))
    if ($accessPassword.Length -lt 20) { throw "The stored access password for $($share.key) is too short." }
    $accessPasswords[[string]$share.key] = $accessPassword
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$null = Get-Command loclx.exe -ErrorAction Stop
$logDirectory = Join-Path (Split-Path -Parent $SecretsPath) "logs"
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$launchers = @{}
try {
    foreach ($share in @($config.shares)) {
        $launchers[[string]$share.key] = Start-ManagedShare `
            -Share $share `
            -Repository $repository `
            -DatabaseUrl ([string]$secrets.databaseUrl) `
            -ConnectorSecret $connectorSecret `
            -AccessPassword $accessPasswords[[string]$share.key] `
            -LogDirectory $logDirectory `
            -NodePath $node
        Wait-ForManagedShare -Share $share -AccessPassword $accessPasswords[[string]$share.key]
        Write-Output "PennyWise beta share ready: https://$($share.subdomain).loclx.io/"
    }

    while ($true) {
        Start-Sleep -Seconds 15
        foreach ($share in @($config.shares)) {
            $key = [string]$share.key
            if (
                -not (Test-ProcessRunning -Process $launchers[$key]) -or
                -not (Test-ManagedShare -Share $share -AccessPassword $accessPasswords[$key])
            ) {
                Stop-ManagedShare -Subdomain ([string]$share.subdomain)
                $launchers[$key] = Start-ManagedShare `
                    -Share $share `
                    -Repository $repository `
                    -DatabaseUrl ([string]$secrets.databaseUrl) `
                    -ConnectorSecret $connectorSecret `
                    -AccessPassword $accessPasswords[$key] `
                    -LogDirectory $logDirectory `
                    -NodePath $node
                Wait-ForManagedShare -Share $share -AccessPassword $accessPasswords[$key]
                Write-Output "PennyWise beta share recovered: https://$($share.subdomain).loclx.io/"
            }
        }
    }
}
catch {
    foreach ($share in @($config.shares)) {
        Stop-ManagedShare -Subdomain ([string]$share.subdomain)
    }
    throw
}
