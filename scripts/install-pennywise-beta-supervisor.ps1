[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "..\infrastructure\beta\pennywise-controlled-shares.json"),
    [string]$SecretsPath = (Join-Path $env:LOCALAPPDATA "PennyWiseAccounting\beta\pennywise-beta-secrets.clixml"),
    [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath -ErrorAction Stop).Path
$SecretsPath = (Resolve-Path -LiteralPath $SecretsPath -ErrorAction Stop).Path
$supervisorPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "pennywise-beta-supervisor.ps1") -ErrorAction Stop).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskName = "PennyWise Beta Tunnel Supervisor"
$userId = "$env:USERDOMAIN\$env:USERNAME"

$arguments = '-NoProfile -File "{0}" -ConfigPath "{1}" -SecretsPath "{2}"' -f `
    $supervisorPath, $ConfigPath, $SecretsPath
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Keeps PennyWise Accounting controlled-beta LocalXpose shares running for named testers." `
    -Force | Out-Null

if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Output "Scheduled task '$taskName' is installed for $userId. It runs only while this Windows user is signed in."
