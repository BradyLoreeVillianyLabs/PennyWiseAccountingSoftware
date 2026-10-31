[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "..\infrastructure\beta\pennywise-controlled-shares.json"),
    [switch]$UninstallTask
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$taskName = "PennyWise Beta Tunnel Supervisor"

function Get-CommandLineArgument {
    param([Parameter(Mandatory)][string]$CommandLine, [Parameter(Mandatory)][string]$Name)

    $pattern = "--" + [regex]::Escape($Name) + '\s+(?:"(?<value>[^"]+)"|(?<value>\S+))'
    $match = [regex]::Match($CommandLine, $pattern)
    if ($match.Success) { return $match.Groups["value"].Value }
    return $null
}

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($config.environment -ne "controlled-beta") { throw "Refusing to stop a non-beta configuration." }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if ($UninstallTask) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
}

foreach ($share in @($config.shares)) {
    $subdomain = [string]$share.subdomain
    if ($subdomain -notmatch "^pennywise[a-z0-9-]+$") { throw "Refusing an unmanaged subdomain." }
    $launchers = @(
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.Name -eq "node.exe" -and
                $_.CommandLine -match "scripts/start-loclx-share\\.mjs" -and
                (Get-CommandLineArgument -CommandLine $_.CommandLine -Name "subdomain") -eq $subdomain
            }
    )
    foreach ($launcher in $launchers) {
        & taskkill.exe /pid $launcher.ProcessId /t /f *> $null
    }
}

Write-Output "PennyWise beta shares were stopped. QBWooBridge and non-PennyWise tunnels were not touched."
