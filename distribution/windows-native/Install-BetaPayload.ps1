$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = $env:PENNYWISE_SETUP_ROOT
$package = Join-Path $stage 'package.msix'
$activation = Join-Path $stage 'activation.json'
$dataRoot = Join-Path $env:LOCALAPPDATA 'PennyWiseAccounting'
$signature = Get-AuthenticodeSignature -LiteralPath $package
if ($signature.Status -ne 'Valid') { throw "Package signature validation failed: $($signature.Status)" }
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path $stage 'publisher.cer'))
if ($signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) { throw 'Package publisher does not match the embedded beta certificate.' }
$envelope = Get-Content -LiteralPath $activation -Raw | ConvertFrom-Json
$encoded = $envelope.payload.Replace('-', '+').Replace('_', '/')
$encoded = $encoded.PadRight($encoded.Length + ((4 - $encoded.Length % 4) % 4), '=')
$claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
$identityFile = Join-Path $dataRoot 'installation.json'
if (Test-Path -LiteralPath $identityFile) {
  $existing = Get-Content -LiteralPath $identityFile -Raw | ConvertFrom-Json
  if ($existing.installId -ne $claims.installId) { throw 'This beta installer belongs to another participant. Existing books and activation were not changed.' }
}
$registryId = Get-ItemPropertyValue 'HKCU:\Software\PennyWiseAccounting' -Name InstallId -ErrorAction SilentlyContinue
if ($registryId -and $registryId -ne $claims.installId) { throw 'This beta installer does not match the existing Windows installation identity.' }
$lock = Join-Path $dataRoot 'launcher.lock'
if (Test-Path -LiteralPath $lock) {
  $launcherPid = [int](Get-Content -LiteralPath $lock -Raw)
  if (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue) {
    [IO.File]::WriteAllText((Join-Path $dataRoot 'shutdown-request.json'), '{"reason":"setup-update"}')
    $deadline = (Get-Date).AddSeconds(90)
    while ((Test-Path -LiteralPath $lock) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    if (Test-Path -LiteralPath $lock) { throw 'PennyWise could not close safely for the update. Close the app and retry.' }
  }
}
Add-AppxPackage -Path $package -ForceApplicationShutdown
$installed = Get-AppxPackage -Name 'TypeWritingMonkeys.PennyWiseAccounting' | Sort-Object Version -Descending | Select-Object -First 1
if (-not $installed) { throw 'Windows did not register PennyWise.' }
$resources = Join-Path $installed.InstallLocation 'resources'
# A non-packaged setup process cannot execute arbitrary children in WindowsApps.
# Copy the runtime from the signature-verified package into our private staging
# directory, as the launcher already does for PostgreSQL's child-process tools.
$provisionNode = Join-Path $stage 'node.exe'
Copy-Item -LiteralPath (Join-Path $resources 'node\node.exe') -Destination $provisionNode
if ((Get-FileHash -LiteralPath $provisionNode).Hash -ne (Get-FileHash -LiteralPath (Join-Path $resources 'node\node.exe')).Hash) { throw 'Provisioning runtime verification failed.' }
& $provisionNode (Join-Path $resources 'provision-beta.cjs') $activation (Join-Path $resources 'license-public-key.pem')
if ($LASTEXITCODE -ne 0) { throw 'Offline activation provisioning failed.' }
Write-Output "Installed and activated $($installed.Version)."
if ($env:PENNYWISE_SETUP_NO_LAUNCH -ne '1') {
  Add-Type -Path (Join-Path $resources 'application-activation.cs')
  $appProcessId = [PennyWiseApplication]::Start("$($installed.PackageFamilyName)!PennyWiseAccounting", '')
  $launcher = Get-Process -Id $appProcessId -ErrorAction Stop
  $deadline = (Get-Date).AddMinutes(6)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    if ($launcher.HasExited) { throw "PennyWise exited during startup ($($launcher.ExitCode))." }
    $stateFile = Join-Path $dataRoot 'runtime-state.json'
    if (Test-Path -LiteralPath $stateFile) {
      try {
        $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $api = Invoke-WebRequest "http://127.0.0.1:$($state.apiPort)/health" -UseBasicParsing -TimeoutSec 3
        $web = Invoke-WebRequest "http://127.0.0.1:$($state.webPort)/" -UseBasicParsing -TimeoutSec 3
        if ($api.StatusCode -eq 200 -and $web.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'PennyWise did not become ready within six minutes. Open Support Diagnostics.' }
  Write-Output "API and web are healthy. PennyWise opened successfully."
}
