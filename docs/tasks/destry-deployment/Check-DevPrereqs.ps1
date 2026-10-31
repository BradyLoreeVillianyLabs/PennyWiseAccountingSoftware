<#
.SYNOPSIS
Reports whether this machine can run and debug PennyWise locally.

.DESCRIPTION
Read-only. Checks the tools and services WINDOWS_TESTING.md requires and prints
what is present, what is missing, and the next command to run. Installs nothing
and changes nothing.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Test-Tool {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$VersionArgument = "--version",
        [string]$Minimum = ""
    )

    $resolved = $null
    try { $resolved = Get-Command $Command -ErrorAction Stop } catch { $resolved = $null }
    if ($null -eq $resolved) {
        return [pscustomobject]@{ Name = $Name; Present = $false; Detail = "not found" }
    }

    $version = ""
    try {
        $version = (& $Command $VersionArgument 2>&1 | Select-Object -First 1).ToString().Trim()
    } catch {
        $version = "installed (version unavailable)"
    }

    $detail = $version
    if ($Minimum -ne "") { $detail = "$version (need $Minimum or newer)" }

    return [pscustomobject]@{ Name = $Name; Present = $true; Detail = $detail }
}

function Test-Port {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $listener = $null
    try { $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop } catch { $listener = $null }
    $present = $null -ne $listener
    $detail = "nothing listening"
    if ($present) { $detail = "listening" }

    return [pscustomobject]@{ Name = "$Name (port $Port)"; Present = $present; Detail = $detail }
}

Write-Host ""
Write-Host "PennyWise development prerequisites" -ForegroundColor Cyan
Write-Host "-----------------------------------"

$tools = @(
    (Test-Tool -Name "Node.js"  -Command "node"     -Minimum "v22"),
    (Test-Tool -Name "npm"      -Command "npm"),
    (Test-Tool -Name "corepack" -Command "corepack"),
    (Test-Tool -Name "Docker"   -Command "docker")
)

foreach ($tool in $tools) {
    $mark = "MISSING"
    $colour = "Yellow"
    if ($tool.Present) { $mark = "  ok   "; $colour = "Green" }
    Write-Host ("[{0}] {1,-10} {2}" -f $mark, $tool.Name, $tool.Detail) -ForegroundColor $colour
}

Write-Host ""
Write-Host "Data services" -ForegroundColor Cyan
Write-Host "-------------"

$services = @(
    (Test-Port -Port 5432 -Name "PostgreSQL (development)"),
    (Test-Port -Port 5433 -Name "PostgreSQL (test)"),
    (Test-Port -Port 6379 -Name "Redis")
)

foreach ($service in $services) {
    $mark = "MISSING"
    $colour = "Yellow"
    if ($service.Present) { $mark = "  ok   "; $colour = "Green" }
    Write-Host ("[{0}] {1,-28} {2}" -f $mark, $service.Name, $service.Detail) -ForegroundColor $colour
}

Write-Host ""
Write-Host "Repository state" -ForegroundColor Cyan
Write-Host "----------------"

$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$envFile = Join-Path $root ".env"
$modules = Join-Path $root "node_modules"

$envPresent = Test-Path -LiteralPath $envFile
$envDetail = "not created - copy .env.example to .env"
if ($envPresent) { $envDetail = "present" }

$modulesPresent = Test-Path -LiteralPath $modules
$modulesDetail = "not installed - run corepack pnpm install"
if ($modulesPresent) { $modulesDetail = "installed" }

Write-Host ("     root: {0}" -f $root)
Write-Host ("     .env: {0}" -f $envDetail)
Write-Host ("  modules: {0}" -f $modulesDetail)

Write-Host ""
Write-Host "Next step" -ForegroundColor Cyan
Write-Host "---------"

$dockerPresent = ($tools | Where-Object { $_.Name -eq "Docker" }).Present
$dbPresent = ($services | Where-Object { $_.Name -like "PostgreSQL (development)*" }).Present

if (-not $dockerPresent -and -not $dbPresent) {
    Write-Host "Provide PostgreSQL and Redis first - see DEV_DEBUG_SETUP.md, 'Choose how to provide Postgres and Redis'."
} elseif (-not $dbPresent) {
    Write-Host "docker compose up -d postgres postgres-test redis"
} elseif (-not $modulesPresent) {
    Write-Host "corepack pnpm install --frozen-lockfile"
} elseif (-not $envPresent) {
    Write-Host "Copy-Item .env.example .env"
} else {
    Write-Host "corepack pnpm db:generate; corepack pnpm db:migrate:deploy"
    Write-Host "then: corepack pnpm --filter @clearledger/api dev"
}

Write-Host ""

exit 0
