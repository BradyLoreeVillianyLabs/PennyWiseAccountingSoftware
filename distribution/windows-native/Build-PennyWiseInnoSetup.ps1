[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Version,
  [Parameter(Mandatory)][string]$LicensePublicKeyPath,
  [Parameter(Mandatory)][string]$ActivationPath,
  [Parameter(Mandatory)][string]$RedistPath,
  [Parameter(Mandatory)][string]$OutputPath,
  [string]$Publisher = "CN=PennyWise Accounting QA",
  [switch]$SkipPrismaGenerate
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "Installer Version must have four numeric fields." }
$output = [IO.Path]::GetFullPath($OutputPath)
if ([IO.Path]::GetExtension($output).ToLowerInvariant() -ne ".exe") { throw "OutputPath must end in .exe." }
if (Test-Path -LiteralPath $output) { throw "Installer already exists; choose a new versioned output name." }
foreach ($required in @($LicensePublicKeyPath, $ActivationPath, $RedistPath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required installer input is missing: $required" }
}

$redist = (Resolve-Path -LiteralPath $RedistPath).Path
$activation = (Resolve-Path -LiteralPath $ActivationPath).Path
$publicKey = (Resolve-Path -LiteralPath $LicensePublicKeyPath).Path
$redistSignature = Get-AuthenticodeSignature -LiteralPath $redist
if ($redistSignature.Status -ne "Valid" -or $redistSignature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
  throw "Visual C++ runtime must have a valid Microsoft signature."
}

$activationEnvelope = Get-Content -LiteralPath $activation -Raw | ConvertFrom-Json
$payload = $activationEnvelope.payload.Replace('-', '+').Replace('_', '/')
$payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
$activationClaims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
if ($activationEnvelope.alg -ne "Ed25519" -or $activationClaims.edition -ne "BETA_20" -or $activationClaims.slot -notin 1..20) {
  throw "ActivationPath is not a supported PennyWise BETA_20 activation file."
}

$certificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object {
    $_.Subject -eq $Publisher -and
    $_.HasPrivateKey -and
    $_.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3"
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
if (-not $certificate) { throw "A usable self-signed PennyWise beta code-signing certificate was not found." }
if ($certificate.NotAfter -le (Get-Date).AddDays(30)) { throw "The PennyWise beta signing certificate expires within 30 days." }

$scriptRoot = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
$iscc = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup 6.7.3 or later is required to build the beta installer." }
$compilerBanner = (& $iscc /? 2>&1 | Select-Object -First 1)
if ($compilerBanner -notmatch '^Inno Setup 6 Command-Line Compiler') {
  throw "The selected Inno compiler is not the stable Inno Setup 6 release: $compilerBanner"
}
$sdkBin = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
  Where-Object { Test-Path -LiteralPath $_ } |
  Sort-Object -Descending |
  Select-Object -First 1
if (-not $sdkBin) { throw "Windows SDK SignTool is required to sign the beta installer." }

$outputDirectory = Split-Path -Parent $output
$outputBaseName = [IO.Path]::GetFileNameWithoutExtension($output)
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

& (Join-Path $scriptRoot "Build-PennyWiseMsix.ps1") `
  -Version $Version `
  -Publisher $Publisher `
  -LicensePublicKeyPath $publicKey `
  -RequireBeta20Activation `
  -StageOnly `
  -SkipPrismaGenerate:$SkipPrismaGenerate
if ($LASTEXITCODE -ne 0) { throw "Native runtime staging failed." }

$stage = Join-Path $scriptRoot "build\stage"
$stageActivation = Join-Path $stage "resources\activation.json"
Copy-Item -LiteralPath $activation -Destination $stageActivation -Force
$releasePath = Join-Path $stage "resources\package-release.json"
$release = Get-Content -LiteralPath $releasePath -Raw | ConvertFrom-Json
$release | Add-Member -NotePropertyName "signing" -NotePropertyValue "qa-self-signed-inno" -Force
$release | Add-Member -NotePropertyName "distribution" -NotePropertyValue "self-contained-inno" -Force
[IO.File]::WriteAllText(
  $releasePath,
  "$($release | ConvertTo-Json -Depth 4)$([Environment]::NewLine)",
  (New-Object System.Text.UTF8Encoding($false))
)

$signTargets = @(
  Get-ChildItem -LiteralPath $stage -Filter "PennyWise*.exe" -File
  Get-Item -LiteralPath (Join-Path $stage "resources\node\node.exe")
)
foreach ($target in $signTargets) {
  & $sdkBin sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $target.FullName
  if ($LASTEXITCODE -ne 0) { throw "Could not sign beta runtime executable: $($target.FullName)" }
  $signed = Get-AuthenticodeSignature -LiteralPath $target.FullName
  if ($signed.Status -ne "Valid" -or $signed.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
    throw "Beta runtime signature verification failed: $($target.FullName)"
  }
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("PennyWiseInnoBuild-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
try {
  $certificatePath = Join-Path $temporary "PennyWise-Beta.cer"
  Export-Certificate -Cert $certificate -FilePath $certificatePath | Out-Null
  # Keep literal quotes out of ISCC's PowerShell 5.1 command line. Inno expands
  # $q immediately before invoking the sign tool, so paths containing spaces
  # remain correctly quoted without causing ISCC to see extra script arguments.
  $signCommand = ('$q{0}$q sign /fd SHA256 /sha1 {1} /s My $f' -f $sdkBin, $certificate.Thumbprint)
  & $iscc `
    "/Spennywise=$signCommand" `
    "/DVersion=$Version" `
    "/DStageDir=$stage" `
    "/DCertificatePath=$certificatePath" `
    "/DCertificateFileName=$([IO.Path]::GetFileName($certificatePath))" `
    "/DRedistPath=$redist" `
    "/DRedistFileName=$([IO.Path]::GetFileName($redist))" `
    "/DCertificateThumbprint=$($certificate.Thumbprint)" `
    "/DOutputDir=$outputDirectory" `
    "/DOutputBaseFilename=$outputBaseName" `
    (Join-Path $scriptRoot "PennyWiseBeta.iss")
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed." }
  if (-not (Test-Path -LiteralPath $output)) { throw "Inno Setup did not create the expected installer." }
  $setupSignature = Get-AuthenticodeSignature -LiteralPath $output
  if ($setupSignature.Status -ne "Valid" -or $setupSignature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint) {
    throw "Self-signed installer verification failed."
  }
  $hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$output.sha256", "$hash  $([IO.Path]::GetFileName($output))$([Environment]::NewLine)", [Text.Encoding]::ASCII)
  Write-Output "Built: $output"
  Write-Output "SHA-256: $hash"
  Write-Output "Beta slot: $($activationClaims.slot)"
} finally {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if ([IO.Path]::GetFullPath($temporary).StartsWith($tempRoot) -and ([IO.Path]::GetFileName($temporary)).StartsWith("PennyWiseInnoBuild-")) {
    Remove-Item -LiteralPath $temporary -Recurse -Force
  }
}
