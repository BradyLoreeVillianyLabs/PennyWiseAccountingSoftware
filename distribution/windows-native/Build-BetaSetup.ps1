[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$PackagePath,
  [Parameter(Mandatory)][string]$ActivationPath,
  [Parameter(Mandatory)][string]$RedistPath,
  [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputPath) { throw 'Setup already exists; use a new output name.' }
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$redist = (Resolve-Path -LiteralPath $RedistPath).Path
$signature = Get-AuthenticodeSignature -LiteralPath $package
if ($signature.Status -ne 'Valid') { throw 'MSIX signature must validate before creating setup.' }
$microsoft = Get-AuthenticodeSignature -LiteralPath $redist
if ($microsoft.Status -ne 'Valid' -or $microsoft.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Visual C++ runtime must have a valid Microsoft signature.' }
$staging = Join-Path ([IO.Path]::GetTempPath()) ('PennyWiseSetupBuild-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
  $certificate = Join-Path $staging 'publisher.cer'
  Export-Certificate -Cert $signature.SignerCertificate -FilePath $certificate | Out-Null
  [IO.File]::WriteAllText((Join-Path $staging 'package.sha256'), (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant())
  [IO.File]::WriteAllText((Join-Path $staging 'vcredist.sha256'), (Get-FileHash -LiteralPath $redist -Algorithm SHA256).Hash.ToLowerInvariant())
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ /r:System.Windows.Forms.dll "/out:$OutputPath" "/resource:$package,package.msix" "/resource:$certificate,publisher.cer" "/resource:$ActivationPath,activation.json" "/resource:$redist,vc_redist.x64.exe" "/resource:$staging\package.sha256,package.sha256" "/resource:$staging\vcredist.sha256,vcredist.sha256" "/resource:$PSScriptRoot\Install-BetaPayload.ps1,install.ps1" (Join-Path $PSScriptRoot 'Setup.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Setup compilation failed.' }
  $signTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  & $signTool sign /fd SHA256 /sha1 $signature.SignerCertificate.Thumbprint /s My $OutputPath
  if ($LASTEXITCODE -ne 0) { throw 'Setup signing failed.' }
  & $signTool verify /pa $OutputPath
  if ($LASTEXITCODE -ne 0) { throw 'Setup signature verification failed.' }
  $hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$OutputPath.sha256", "$hash  $([IO.Path]::GetFileName($OutputPath))`n")
  Write-Output "Built: $OutputPath"
} finally {
  if ([IO.Path]::GetFullPath($staging).StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and ([IO.Path]::GetFileName($staging)).StartsWith('PennyWiseSetupBuild-')) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
