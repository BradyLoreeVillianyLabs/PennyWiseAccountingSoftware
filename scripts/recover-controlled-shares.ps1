[CmdletBinding()]
param(
    [string] $JesseRecoveryPassword = $env:CLEARLEDGER_JESSE_RECOVERY_PASSWORD,
    [switch] $UseDemoCompany
)

. (Join-Path $PSScriptRoot "restart-controlled-shares.ps1") -FunctionsOnly

if (
    [string]::IsNullOrWhiteSpace($JesseRecoveryPassword) -or
    $JesseRecoveryPassword.Length -lt 20 -or
    $JesseRecoveryPassword -match '[\s"]'
) {
    throw (
        "Jesse's recovery password must contain at least 20 characters and " +
        "cannot contain whitespace or a double quote."
    )
}

$durableDatabaseUrl =
    "postgresql://clearledger:clearledger_dev_only@localhost:55432/clearledger?schema=public"
$bootstrapPort = 3501

$launchers = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "node.exe" -and
            $_.CommandLine -match 'scripts/start-loclx-share\.mjs'
        }
)
if ($launchers.Count -lt 1 -or $launchers.Count -gt $expectedShares.Count) {
    throw (
        "Expected between one and $($expectedShares.Count) validated ClearLedger " +
        "share launchers; found $($launchers.Count). No process was stopped."
    )
}

$configurationBySubdomain = @{}
$preservedSecrets = @()
$referenceExecutable = $null
$referencePath = $null

foreach ($launcher in $launchers) {
    $commandLine = $launcher.CommandLine
    $subdomain = Get-LauncherArgument -CommandLine $commandLine -Name "subdomain"
    if (-not $expectedShares.Contains($subdomain)) {
        throw "Unexpected share '$subdomain'. No process was stopped."
    }
    if ($configurationBySubdomain.ContainsKey($subdomain)) {
        throw "Duplicate share '$subdomain'. No process was stopped."
    }

    $webPort = [int](Get-LauncherArgument -CommandLine $commandLine -Name "web-port")
    $apiPort = [int](Get-LauncherArgument -CommandLine $commandLine -Name "api-port")
    if (
        $webPort -ne $expectedShares[$subdomain].WebPort -or
        $apiPort -ne $expectedShares[$subdomain].ApiPort
    ) {
        throw "Unexpected ports for $subdomain. No process was stopped."
    }

    $executableMatch = [regex]::Match(
        $commandLine,
        '^\s*"(?<executable>[^"]+)"\s+(?<arguments>.+)$'
    )
    if (-not $executableMatch.Success) {
        throw "Could not safely parse $subdomain. No process was stopped."
    }

    $environment = @{}
    foreach (
        $entry in [ClearLedgerProcessEnvironment]::Read([int]$launcher.ProcessId)
    ) {
        $separator = $entry.IndexOf('=')
        if ($separator -gt 0) {
            $environment[$entry.Substring(0, $separator)] =
                $entry.Substring($separator + 1)
        }
    }

    $secret = [string]$environment["CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET"]
    if ($secret.Length -lt 32) {
        throw "Could not preserve $subdomain's encryption secret. No process was stopped."
    }
    $preservedSecrets += $secret
    if (-not $referenceExecutable) {
        $referenceExecutable = $executableMatch.Groups["executable"].Value
        $referencePath = [string]$environment["Path"]
    }

    $configurationBySubdomain[$subdomain] = [pscustomobject]@{
        Subdomain = $subdomain
        WebPort = $webPort
        ApiPort = $apiPort
        Email = (Get-LauncherArgument -CommandLine $commandLine -Name "email")
        Name = (Get-LauncherArgument -CommandLine $commandLine -Name "name")
        Username = (Get-LauncherArgument -CommandLine $commandLine -Name "username")
        Password = (Get-LauncherArgument -CommandLine $commandLine -Name "password")
        OldPid = [int]$launcher.ProcessId
        OriginalCommandLine = $commandLine
        OriginalArguments = $executableMatch.Groups["arguments"].Value
        Organization = $null
        DemoCreated = $false
    }
}

if (@($preservedSecrets | Select-Object -Unique).Count -ne 1) {
    throw "The active shares do not use one stable encryption secret. No process was stopped."
}
$encryptionSecret = $preservedSecrets[0]

foreach ($subdomain in $expectedShares.Keys) {
    if ($configurationBySubdomain.ContainsKey($subdomain)) {
        continue
    }
    if ($subdomain -ne "clearledgerpreview") {
        throw "Required share '$subdomain' is missing. No process was stopped."
    }

    $expected = $expectedShares[$subdomain]
    $configurationBySubdomain[$subdomain] = [pscustomobject]@{
        Subdomain = $subdomain
        WebPort = $expected.WebPort
        ApiPort = $expected.ApiPort
        Email = $expected.Email
        Name = $expected.Name
        Username = $expected.Username
        Password = $JesseRecoveryPassword
        OldPid = $null
        OriginalCommandLine = $null
        OriginalArguments = $null
        Organization = $null
        DemoCreated = $false
    }
}

$bootstrapListeners = @(
    Get-NetTCPConnection -LocalPort $bootstrapPort -State Listen -ErrorAction SilentlyContinue
)
if ($bootstrapListeners.Count -ne 0) {
    throw "Bootstrap port $bootstrapPort is already in use. No share process was stopped."
}

$env:DATABASE_URL = $durableDatabaseUrl
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = $encryptionSecret
$env:HOST = "127.0.0.1"
$env:PORT = [string]$bootstrapPort
$env:APP_BASE_URL = "http://127.0.0.1:$bootstrapPort"
$env:API_BASE_URL = "http://127.0.0.1:$bootstrapPort"
$env:NODE_ENV = "development"
if (-not [string]::IsNullOrWhiteSpace($referencePath)) {
    $env:Path = $referencePath
}

$bootstrapErrorLog = Join-Path $env:TEMP "clearledger-share-bootstrap-errors.log"
$bootstrapArguments = @{
    FilePath = $referenceExecutable
    ArgumentList = "--import tsx apps/api/src/index.ts"
    WorkingDirectory = $repository
    WindowStyle = "Hidden"
    RedirectStandardOutput = "NUL"
    RedirectStandardError = $bootstrapErrorLog
    PassThru = $true
}
$bootstrapApi = Start-Process @bootstrapArguments

try {
    $healthDeadline = (Get-Date).AddSeconds(45)
    $bootstrapReady = $false
    do {
        try {
            $health = Invoke-WebRequest `
                -Uri "http://127.0.0.1:$bootstrapPort/health" `
                -UseBasicParsing `
                -TimeoutSec 3
            $bootstrapReady = $health.StatusCode -eq 200
        }
        catch {
            $bootstrapReady = $false
        }
        if ($bootstrapReady) {
            break
        }
        if ($bootstrapApi.HasExited) {
            throw "The durable-database bootstrap API exited during startup."
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $healthDeadline)
    if (-not $bootstrapReady) {
        throw "The durable-database bootstrap API did not become healthy."
    }

    foreach (
        $configuration in (
            $configurationBySubdomain.Values | Sort-Object WebPort
        )
    ) {
        $headers = @{
            "x-clearledger-user-email" = $configuration.Email
            "x-clearledger-user-name" = $configuration.Name
            "x-clearledger-email-verified" = "true"
            "idempotency-key" = [guid]::NewGuid().ToString()
        }
        if ($UseDemoCompany) {
            $demo = Invoke-RestMethod `
                -Method Post `
                -Uri "http://127.0.0.1:$bootstrapPort/v1/demo-company" `
                -Headers $headers `
                -ContentType "application/json" `
                -Body '{"templateKey":"canadian-service"}' `
                -TimeoutSec 45
            $demoCompany = $demo.demoCompany
            $currencies = @($demoCompany.enabledCurrencies)
            if (
                -not $demoCompany.setupComplete -or
                -not $currencies.Contains("CAD") -or
                -not $currencies.Contains("USD") -or
                [string]::IsNullOrWhiteSpace($demoCompany.organizationId)
            ) {
                throw "The $($configuration.Subdomain) demo company was not fully seeded."
            }
            $configuration.Organization = $demoCompany.organizationId
            $configuration.DemoCreated = [bool]$demoCompany.created
        }
        else {
            $freshName = "$($configuration.Name) Blank Company"
            $organization = Invoke-RestMethod `
                -Method Post `
                -Uri "http://127.0.0.1:$bootstrapPort/v1/organizations" `
                -Headers $headers `
                -ContentType "application/json" `
                -Body (@{
                    legalName = $freshName
                    displayName = $freshName
                    currency = "CAD"
                    timezone = "America/Edmonton"
                } | ConvertTo-Json) `
                -TimeoutSec 45
            $configuration.Organization = [string]$organization.organization.id
            if ([string]::IsNullOrWhiteSpace($configuration.Organization)) {
                throw "The blank company for $($configuration.Subdomain) was not created."
            }
        }
    }
}
finally {
    if (-not $bootstrapApi.HasExited) {
        & taskkill.exe /PID $bootstrapApi.Id /T /F 1>$null 2>$null
    }
}

foreach ($configuration in $configurationBySubdomain.Values) {
    if ($null -eq $configuration.OldPid) {
        continue
    }
    $current = Get-CimInstance Win32_Process `
        -Filter "ProcessId = $($configuration.OldPid)"
    if (
        -not $current -or
        $current.CommandLine -ne $configuration.OriginalCommandLine
    ) {
        throw (
            "The $($configuration.Subdomain) launcher changed during recovery. " +
            "No remaining share process was stopped."
        )
    }
}

foreach ($configuration in $configurationBySubdomain.Values) {
    if ($null -ne $configuration.OldPid) {
        & taskkill.exe /PID $configuration.OldPid /T /F 1>$null 2>$null
    }
}
Wait-ForPortsToClose -Ports @(
    $configurationBySubdomain.Values |
        ForEach-Object { $_.WebPort; $_.ApiPort }
)

$env:DATABASE_URL = $durableDatabaseUrl
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = $encryptionSecret
$env:NODE_ENV = "development"
$results = foreach (
    $configuration in ($configurationBySubdomain.Values | Sort-Object WebPort)
) {
    if ($configuration.OriginalArguments) {
        $organizationArgument = [regex]'(?<=--organization\s)(?:"[^"]+"|\S+)'
        $arguments = $organizationArgument.Replace(
            $configuration.OriginalArguments,
            $configuration.Organization,
            1
        )
    }
    else {
        $arguments =
            'scripts/start-loclx-share.mjs ' +
            "--email $($configuration.Email) " +
            "--name `"$($configuration.Name)`" " +
            "--organization $($configuration.Organization) " +
            "--subdomain $($configuration.Subdomain) " +
            "--reserved --username $($configuration.Username) " +
            "--password $($configuration.Password) " +
            "--web-port $($configuration.WebPort) " +
            "--api-port $($configuration.ApiPort)"
    }

    $errorLog = Join-Path $env:TEMP "$($configuration.Subdomain)-share-errors.log"
    $startArguments = @{
        FilePath = $referenceExecutable
        ArgumentList = $arguments
        WorkingDirectory = $repository
        WindowStyle = "Hidden"
        RedirectStandardOutput = "NUL"
        RedirectStandardError = $errorLog
        PassThru = $true
    }
    $newLauncher = Start-Process @startArguments

    Wait-ForLocalShare `
        -Launcher $newLauncher `
        -WebPort $configuration.WebPort `
        -ApiPort $configuration.ApiPort `
        -Subdomain $configuration.Subdomain

    $membershipHeaders = @{
        "x-clearledger-user-email" = $configuration.Email
        "x-clearledger-user-name" = $configuration.Name
    }
    $membership = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$($configuration.ApiPort)/v1/organizations" `
        -Headers $membershipHeaders `
        -TimeoutSec 10
    if (-not (
        $membership.organizations |
            Where-Object {
                $_.organizationId -eq $configuration.Organization
            }
    )) {
        throw "$($configuration.Subdomain) is healthy but lacks its rebuilt company."
    }

    Wait-ForPublicShare `
        -Launcher $newLauncher `
        -Subdomain $configuration.Subdomain `
        -Username $configuration.Username `
        -Password $configuration.Password

    [pscustomobject]@{
        Share = $configuration.Subdomain
        NewPid = $newLauncher.Id
        Api = "healthy"
        Web = "healthy"
        Organization = "fully seeded"
        Currencies = "CAD, USD"
        Public = "HTTP 200"
    }
}

$quickBooksTunnel = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -like "loclx*" -and
        $_.CommandLine -match 'woobridge\.loclx\.io'
    }

$results | Format-Table -AutoSize
[pscustomobject]@{
    Storage = "durable local database"
    QBWooBridgeTunnel = if ($quickBooksTunnel) {
        "untouched and running"
    }
    else {
        "not found"
    }
    QBWooBridgePid = ($quickBooksTunnel.ProcessId -join ',')
} | Format-List
