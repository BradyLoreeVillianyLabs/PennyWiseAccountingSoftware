[CmdletBinding()]
param(
  [string]$TestDatabaseUrl = "postgresql://clearledger:clearledger_dev_only@localhost:5433/clearledger_test?schema=public",
  [ValidateRange(1024, 65535)]
  [int]$WebPort = 3650,
  [ValidateRange(1024, 65535)]
  [int]$ApiPort = 3651
)

$ErrorActionPreference = "Stop"
if ($WebPort -eq $ApiPort) { throw "WebPort and ApiPort must be different." }

$env:TEST_DATABASE_URL = $TestDatabaseUrl
$env:DATABASE_URL = $TestDatabaseUrl
$env:PLAYWRIGHT_WEB_PORT = $WebPort.ToString()
$env:PLAYWRIGHT_API_PORT = $ApiPort.ToString()

& (Join-Path $PSScriptRoot "build-public-beta.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
