<#
.SYNOPSIS
  Creates an isolated PennyWise UI v2 stream: git worktree, branch, test database name and test ports.

.EXAMPLE
  scripts\ui-v2\new-stream.ps1 -Stream sales -Slot 4

  Creates ..\pw-sales on branch ui/sales (from ui/integration) and writes
  ..\pw-sales\.ui-v2-stream.ps1. Dot-source that file in each new terminal before testing:
    . .\.ui-v2-stream.ps1
    corepack.cmd pnpm test:e2e

.NOTES
  -BaseDatabaseUrl defaults to $env:TEST_DATABASE_URL. Only the database name is replaced, so the
  credentials stay in the git-ignored .ui-v2-stream.ps1 and never enter the repository.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9-]{1,30}$')][string]$Stream,
  [Parameter(Mandatory = $true)][ValidateRange(1, 40)][int]$Slot,
  [string]$BaseDatabaseUrl = $env:TEST_DATABASE_URL,
  [string]$BaseBranch = 'ui/integration'
)

$ErrorActionPreference = 'Stop'
$repoRoot = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw 'Run this script from inside the PennyWise git repository.'
}
$repoRoot = $repoRoot.Trim()

if (-not $BaseDatabaseUrl) {
  throw 'Set TEST_DATABASE_URL (any clearledger*_test URL on the loopback test server) or pass -BaseDatabaseUrl.'
}
$uri = [Uri]$BaseDatabaseUrl
if ($uri.Port -eq 55432 -and $uri.AbsolutePath.Trim('/') -eq 'clearledger') {
  throw 'Refusing to derive a stream database from the PennyWise beta database.'
}
$databaseName = 'clearledger_test_' + ($Stream -replace '-', '_')
$builder = [UriBuilder]$uri
$builder.Path = '/' + $databaseName
$streamDatabaseUrl = $builder.Uri.AbsoluteUri

# Ports 3500/3501 are the default browser-test pair, so streams start at 3512.
$webPort = 3510 + ($Slot * 2)
$apiPort = $webPort + 1

$branch = "ui/$Stream"
$worktree = Join-Path (Split-Path $repoRoot -Parent) "pw-$Stream"
if (Test-Path $worktree) { throw "Worktree path already exists: $worktree" }

git -C $repoRoot fetch origin --prune 2>$null
git -C $repoRoot rev-parse --verify --quiet "origin/$BaseBranch" | Out-Null
$startPoint = if ($LASTEXITCODE -eq 0) { "origin/$BaseBranch" } else { $BaseBranch }
git -C $repoRoot rev-parse --verify --quiet $startPoint | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Base branch '$BaseBranch' does not exist locally or on origin. Create it first (see 05_LAUNCH_RUNBOOK.md)."
}

git -C $repoRoot rev-parse --verify --quiet "refs/heads/$branch" | Out-Null
if ($LASTEXITCODE -eq 0) {
  git -C $repoRoot worktree add $worktree $branch
} else {
  git -C $repoRoot worktree add -b $branch $worktree $startPoint
}
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed for $branch." }

$envFile = Join-Path $worktree '.ui-v2-stream.ps1'
@"
# UI v2 stream '$Stream' (slot $Slot). Git-ignored: contains test database credentials.
`$env:UI_V2_STREAM = '$Stream'
`$env:TEST_DATABASE_URL = '$streamDatabaseUrl'
`$env:PLAYWRIGHT_WEB_PORT = '$webPort'
`$env:PLAYWRIGHT_API_PORT = '$apiPort'
Write-Host "UI v2 stream $Stream -> db $databaseName, web $webPort, api $apiPort"
"@ | Set-Content -Path $envFile -Encoding ascii

Write-Host "Created $worktree on $branch from $startPoint."
Write-Host "Database: $databaseName   Web port: $webPort   API port: $apiPort"
Write-Host "Next: cd $worktree; corepack.cmd pnpm install; . .\.ui-v2-stream.ps1"
