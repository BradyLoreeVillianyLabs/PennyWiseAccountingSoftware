[CmdletBinding()]
param([Parameter(Mandatory)][string]$ActivationPath)
$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name 'TypeWritingMonkeys.PennyWiseAccounting'
if (-not $package) { throw 'Install the candidate before this drill.' }
$originalLocal = $env:LOCALAPPDATA
$originalOneDrive = $env:OneDrive
$testRoot = Join-Path $originalLocal ('PennyWiseQA\first-run-' + [guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $testRoot 'PennyWiseAccounting'
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$identity = Get-Content -LiteralPath (Join-Path $originalLocal 'PennyWiseAccounting\installation.json') -Raw
[IO.File]::WriteAllText((Join-Path $dataRoot 'installation.json'), $identity)
Copy-Item -LiteralPath $ActivationPath -Destination (Join-Path $dataRoot 'license.json')
# Fixture configuration avoids changing the real account's scheduled task.
# Scheduled-task execution is a separate installed-account drill.
[IO.File]::WriteAllText((Join-Path $dataRoot 'backup-config.json'), (@{schemaVersion=1; destination=(Join-Path $testRoot 'PennyWiseRecovery'); kind='local-recovery-same-disk'; retain=2} | ConvertTo-Json))
Write-Output "Isolated first-run data: $testRoot"
try {
  $env:LOCALAPPDATA = $testRoot
  Remove-Item Env:OneDrive -ErrorAction SilentlyContinue
  $launcher=Start-Process -FilePath (Join-Path $package.InstallLocation 'PennyWiseAccounting.exe') -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
} finally {
  $env:LOCALAPPDATA = $originalLocal
  if ($null -eq $originalOneDrive) { Remove-Item Env:OneDrive -ErrorAction SilentlyContinue } else { $env:OneDrive = $originalOneDrive }
}
$deadline=(Get-Date).AddMinutes(6)
while ((Get-Date) -lt $deadline) {
  if ($launcher.HasExited) { throw "Isolated launcher exited. Inspect $dataRoot\logs\launcher.log" }
  $statePath=Join-Path $dataRoot 'runtime-state.json'
  if (Test-Path -LiteralPath $statePath) {
    try {
      $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      $api=Invoke-WebRequest "http://127.0.0.1:$($state.apiPort)/health" -UseBasicParsing -TimeoutSec 3
      $web=Invoke-WebRequest "http://127.0.0.1:$($state.webPort)/" -UseBasicParsing -TimeoutSec 3
      if ($api.StatusCode -eq 200 -and $web.StatusCode -eq 200) {
        $secrets=Get-Content -LiteralPath (Join-Path $dataRoot 'runtime-secrets.json') -Raw | ConvertFrom-Json
        $previousPassword=$env:PGPASSWORD
        try {
          $env:PGPASSWORD=$secrets.databaseOwnerPassword
          $migrations=& (Join-Path $dataRoot 'runtime\postgresql\bin\psql.exe') -h 127.0.0.1 -p $state.databasePort -U pennywise_owner -d pennywise -tAc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'
          if ($LASTEXITCODE -ne 0) { throw 'Migration evidence query failed.' }
        } finally { if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD=$previousPassword } }
        $expected=(Get-ChildItem (Join-Path $package.InstallLocation 'resources\app\node_modules\@clearledger\db\prisma\migrations') -Directory).Count
        if ([int]$migrations -ne $expected) { throw "Expected $expected migrations, found $migrations" }
        $evidence=@{version=[string]$package.Version; kind='isolated-new-data-on-build-machine'; api=200; web=200; migrations=[int]$migrations; runtimeSecretsGenerated=$true; webPort=$state.webPort; apiPort=$state.apiPort; launcherPid=$launcher.Id; dataRoot=$dataRoot}
        [IO.File]::WriteAllText((Join-Path $testRoot 'evidence.json'),($evidence | ConvertTo-Json))
        $evidence | ConvertTo-Json
        exit 0
      }
    } catch { $lastProbeError=$_.Exception.Message }
  }
  Start-Sleep -Seconds 1
}
throw "Isolated first run failed: $lastProbeError. Inspect $dataRoot\logs\launcher.log"
