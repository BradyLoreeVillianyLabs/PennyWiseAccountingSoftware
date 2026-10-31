[CmdletBinding()]
param(
    [string] $DatabaseUrl = "postgresql://clearledger:clearledger_dev_only@localhost:55432/clearledger?schema=public",
    [switch] $UseDemoCompany
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$node = (Get-Command node -ErrorAction Stop).Source
$curl = (Get-Command curl.exe -ErrorAction Stop).Source
$shares = @(
    [pscustomobject]@{
        Subdomain = "clearledgerpreview"
        WebPort = 3100
        ApiPort = 3101
        Email = "albertatreeplanting@gmail.com"
        Name = "Jesse Romo"
        Username = "jesse"
    }
    [pscustomobject]@{
        Subdomain = "clearledgeramanda"
        WebPort = 3200
        ApiPort = 3201
        Email = "amanda@clearledger.test"
        Name = "Amanda"
        Username = "amanda"
    }
    [pscustomobject]@{
        Subdomain = "clearledgercindi"
        WebPort = 3300
        ApiPort = 3301
        Email = "cindi@clearledger.test"
        Name = "Cindi"
        Username = "cindi"
    }
    [pscustomobject]@{
        Subdomain = "clearledgerbrady"
        WebPort = 3400
        ApiPort = 3401
        Email = "brady@clearledger.test"
        Name = "Brady"
        Username = "brady"
    }
)
$startedLaunchers = @()
$bootstrap = $null

function New-RandomUrlToken {
    $bytes = New-Object byte[] 48
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    # LocalXpose Basic Auth accepts a conservative alphanumeric credential set.
    return ([Convert]::ToBase64String($bytes) -replace "[^A-Za-z0-9]", "")
}

function Assert-PortFree {
    param([int] $Port)
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        throw "Required ClearLedger test-share port $Port is already in use. No share was started."
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)] [string] $Uri,
        [int] $TimeoutSeconds = 45
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        }
        catch {
            # The local API/web process or the reserved tunnel may still be starting.
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $Uri."
}

function Wait-ForPublicShare {
    param(
        [Parameter(Mandatory = $true)] $Share,
        [int] $TimeoutSeconds = 60
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        & $curl `
            --fail `
            --silent `
            --location `
            --output NUL `
            --user "$($Share.Username):$($Share.Password)" `
            --max-time 15 `
            "https://$($Share.Subdomain).loclx.io/"
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for the public share https://$($Share.Subdomain).loclx.io/."
}

function Stop-ChildTree {
    param([System.Diagnostics.Process] $Process)
    if ($null -ne $Process -and -not $Process.HasExited) {
        & taskkill.exe /PID $Process.Id /T /F 1>$null 2>$null
    }
}

# Force a development-only environment for every process started by this script.
# In particular, no inherited payment, OIDC, webhook, or production database value
# is allowed to turn this into an accidental production share.
$env:NODE_ENV = "development"
$env:DATABASE_URL = $DatabaseUrl
$env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = New-RandomUrlToken
$env:STRIPE_MODE = ""
$env:STRIPE_SECRET_KEY = ""
$env:STRIPE_WEBHOOK_SECRET = ""
$env:PAYMENT_ACCOUNT_ENCRYPTION_SECRET = ""
$env:WEBHOOK_SECRET_ENCRYPTION_SECRET = ""
$env:CONNECTOR_WEBHOOK_BASE_URL = ""
$env:HOST = "127.0.0.1"

foreach ($share in $shares) {
    Assert-PortFree -Port $share.WebPort
    Assert-PortFree -Port $share.ApiPort
}
Assert-PortFree -Port 3501

$existingProductionTunnel = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -like "loclx*" -and
            $_.CommandLine -match "woobridge\.loclx\.io"
        }
)
if ($existingProductionTunnel.Count -gt 0) {
    Write-Output "QBWooBridge tunnel detected and will remain untouched (PID $($existingProductionTunnel.ProcessId -join ','))."
}

try {
    $env:PORT = "3501"
    $env:APP_BASE_URL = "http://127.0.0.1:3501"
    $env:API_BASE_URL = "http://127.0.0.1:3501"
    $bootstrapLog = Join-Path $env:TEMP "clearledger-named-share-bootstrap.log"
    $bootstrapErrorLog = Join-Path $env:TEMP "clearledger-named-share-bootstrap-errors.log"
    $bootstrap = Start-Process `
        -FilePath $node `
        -ArgumentList @("--import", "tsx", "apps/api/src/index.ts") `
        -WorkingDirectory $repository `
        -WindowStyle Hidden `
        -RedirectStandardOutput $bootstrapLog `
        -RedirectStandardError $bootstrapErrorLog `
        -PassThru
    Wait-ForHttp -Uri "http://127.0.0.1:3501/health"

    foreach ($share in $shares) {
        $headers = @{
            "x-clearledger-user-email" = $share.Email
            "x-clearledger-user-name" = $share.Name
            "x-clearledger-email-verified" = "true"
            "idempotency-key" = "named-clearledger-share-v1-$($share.Email.ToLowerInvariant())"
        }
        if ($UseDemoCompany) {
            $demo = Invoke-RestMethod `
                -Method Post `
                -Uri "http://127.0.0.1:3501/v1/demo-company" `
                -Headers $headers `
                -ContentType "application/json" `
                -Body '{"templateKey":"canadian-service"}' `
                -TimeoutSec 60
            $demoCompany = $demo.demoCompany
            if (
                [string]::IsNullOrWhiteSpace([string]$demoCompany.organizationId) -or
                -not $demoCompany.setupComplete
            ) {
                throw "The disposable demo company for $($share.Name) was not fully seeded."
            }
            $organizationId = [string]$demoCompany.organizationId
        }
        else {
            $freshName = "$($share.Name) Blank Company"
            $organization = Invoke-RestMethod `
                -Method Post `
                -Uri "http://127.0.0.1:3501/v1/organizations" `
                -Headers $headers `
                -ContentType "application/json" `
                -Body (@{
                    legalName = $freshName
                    displayName = $freshName
                    currency = "CAD"
                    timezone = "America/Edmonton"
                } | ConvertTo-Json) `
                -TimeoutSec 60
            $organizationId = [string]$organization.organization.id
            if ([string]::IsNullOrWhiteSpace($organizationId)) {
                throw "The blank company for $($share.Name) was not created."
            }
        }
        $share | Add-Member -NotePropertyName Organization -NotePropertyValue $organizationId
        $share | Add-Member -NotePropertyName Password -NotePropertyValue (New-RandomUrlToken)
    }

    Stop-ChildTree -Process $bootstrap
    $bootstrap = $null

    foreach ($share in $shares) {
        $shareLog = Join-Path $env:TEMP "$($share.Subdomain)-share.log"
        $shareErrorLog = Join-Path $env:TEMP "$($share.Subdomain)-share-errors.log"
        $arguments = @(
            "scripts/start-loclx-share.mjs"
            "--email", $share.Email
            "--name", "`"$($share.Name)`""
            "--organization", $share.Organization
            "--subdomain", $share.Subdomain
            "--reserved"
            "--username", $share.Username
            "--password", $share.Password
            "--web-port", [string]$share.WebPort
            "--api-port", [string]$share.ApiPort
        )
        $launcher = Start-Process `
            -FilePath $node `
            -ArgumentList $arguments `
            -WorkingDirectory $repository `
            -WindowStyle Hidden `
            -RedirectStandardOutput $shareLog `
            -RedirectStandardError $shareErrorLog `
            -PassThru
        $startedLaunchers += $launcher
        Wait-ForHttp -Uri "http://127.0.0.1:$($share.ApiPort)/health"
        Wait-ForHttp -Uri "http://127.0.0.1:$($share.WebPort)/"

        Wait-ForPublicShare -Share $share
    }

    Write-Output ""
    Write-Output "ClearLedger development shares are ready."
    Write-Output $(if ($UseDemoCompany) {
            "These are separate local fictional demo companies and do not connect to QBWooBridge production."
        }
        else {
            "These are separate local blank companies. Demo data remains an explicit in-app option and does not connect to QBWooBridge production."
        })
    foreach ($share in $shares) {
        Write-Output ("{0}: https://{1}.loclx.io | Basic Auth {2} / {3} | organization {4}" -f `
            $share.Name, $share.Subdomain, $share.Username, $share.Password, $share.Organization)
    }
    Write-Output ""
    Write-Output "Keep the launcher processes running. Stop only these four ClearLedger launchers when testing is complete."
}
catch {
    foreach ($launcher in $startedLaunchers) { Stop-ChildTree -Process $launcher }
    throw
}
finally {
    Stop-ChildTree -Process $bootstrap
}
