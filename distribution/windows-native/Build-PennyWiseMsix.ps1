[CmdletBinding()]
param(
  [string]$Version = "0.14.0.1",
  [string]$Publisher = "CN=PennyWise Accounting QA",
  [switch]$SelfSign,
  [string]$WindowsSdkBin,
  [string]$PostgresRoot,
  [string]$LicensePublicKeyPath,
  [switch]$RequireBeta20Activation,
  [switch]$StageOnly,
  [switch]$SkipPrismaGenerate
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$buildRoot = Join-Path $PSScriptRoot "build"
$stage = Join-Path $buildRoot "stage"
$outputRoot = Join-Path $PSScriptRoot "output"
$sdkBin = $WindowsSdkBin
if ([string]::IsNullOrWhiteSpace($sdkBin)) {
  $sdkBin = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "x64" } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ "makeappx.exe") } |
    Sort-Object -Descending |
    Select-Object -First 1
}
$makeAppx = Join-Path $sdkBin "makeappx.exe"
$signTool = Join-Path $sdkBin "signtool.exe"
$postgresRoot = if ([string]::IsNullOrWhiteSpace($PostgresRoot)) { "C:\Program Files\PostgreSQL\17" } else { $PostgresRoot }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source

if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw "MSIX Version must have four numeric fields." }
if (-not $SelfSign -and [string]::IsNullOrWhiteSpace($LicensePublicKeyPath)) { throw "A Store build requires -LicensePublicKeyPath from the protected fulfillment service." }
if ($RequireBeta20Activation -and [string]::IsNullOrWhiteSpace($LicensePublicKeyPath)) { throw "A BETA_20 package requires -LicensePublicKeyPath. Keep the matching private key outside the repository and package." }
foreach ($required in @($makeAppx, (Join-Path $postgresRoot "bin\initdb.exe"), $nodeExe)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required build dependency is missing: $required" }
}
if (-not (Test-Path -LiteralPath $signTool)) { throw "The native SEA build requires SignTool to remove the source Node signature: $signTool" }
if (-not [string]::IsNullOrWhiteSpace($LicensePublicKeyPath) -and -not (Test-Path -LiteralPath $LicensePublicKeyPath)) { throw "License public key not found: $LicensePublicKeyPath" }

$expectedBuildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build'))
if ([IO.Path]::GetFullPath($buildRoot) -ne $expectedBuildRoot) { throw 'Build cleanup path is invalid.' }
$packagePath = Join-Path $outputRoot "PennyWise-Accounting-$Version-x64.msix"
if (Test-Path -LiteralPath $packagePath) { throw 'This package version already exists. Choose a new version; released candidates are immutable.' }
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stage, $outputRoot, (Join-Path $stage "Assets"), (Join-Path $stage "resources") -Force | Out-Null

Push-Location $repoRoot
try {
  if ($SkipPrismaGenerate) {
    $generatedClient = Join-Path $repoRoot "packages\db\generated-client\index.js"
    $generatedEngine = Join-Path $repoRoot "packages\db\generated-client\query_engine-windows.dll.node"
    if (-not (Test-Path -LiteralPath $generatedClient) -or -not (Test-Path -LiteralPath $generatedEngine)) {
      throw "-SkipPrismaGenerate requires an existing generated Prisma client and Windows query engine."
    }
    Write-Warning "Skipping root Prisma generation at the caller's request. Use the default build after stopping running API processes or changing the Prisma schema."
  } else {
    & corepack.cmd pnpm db:generate
    if ($LASTEXITCODE -ne 0) { throw "The PennyWise Prisma client generation failed." }
  }
  & corepack.cmd pnpm --filter @clearledger/web build
  if ($LASTEXITCODE -ne 0) { throw "The PennyWise web asset build failed." }
  & corepack.cmd pnpm --filter @clearledger/api build
  if ($LASTEXITCODE -ne 0) { throw "The PennyWise API build failed." }
  & corepack.cmd pnpm --config.node-linker=hoisted --filter @clearledger/api deploy --prod --legacy (Join-Path $stage "resources\app")
  if ($LASTEXITCODE -ne 0) { throw "The portable API deployment failed." }
} finally { Pop-Location }

$stagedApp = Join-Path $stage "resources\app"
$forbiddenStageEntries = @(".data", ".tmp", "tmp", "distribution", ".env", ".env.local")
foreach ($entry in $forbiddenStageEntries) {
  if (Test-Path -LiteralPath (Join-Path $stagedApp $entry)) {
    throw "The deployment payload contains forbidden local or build data: $entry"
  }
}
$stagedPrisma = Join-Path $stagedApp "node_modules\.bin\prisma.cmd"
$stagedSchema = Join-Path $stagedApp "node_modules\@clearledger\db\prisma\schema.prisma"
if (-not (Test-Path -LiteralPath $stagedPrisma)) { throw "The staged Prisma CLI is missing." }
if (-not (Test-Path -LiteralPath $stagedSchema)) { throw "The staged Prisma schema is missing." }
Push-Location $stagedApp
try {
  & $stagedPrisma generate --schema $stagedSchema
  if ($LASTEXITCODE -ne 0) { throw "The staged Prisma client generation failed." }
  $stagedClient = Join-Path $stagedApp "node_modules\@clearledger\db\generated-client\index.js"
  $stagedRuntimeClient = Join-Path $stagedApp "node_modules\@clearledger\db\generated-client-d5\index.js"
  $stagedDbModule = Join-Path $stagedApp "node_modules\@clearledger\db\dist\index.js"
  if (-not (Test-Path -LiteralPath $stagedClient)) { throw "The staged generated Prisma client is missing." }
  if (-not (Test-Path -LiteralPath $stagedRuntimeClient)) { throw "The staged D5 Prisma runtime client is missing." }
  if (-not (Test-Path -LiteralPath $stagedDbModule)) { throw "The staged PennyWise database module is missing." }
  $stagedDbUri = ([System.Uri]::new((Resolve-Path -LiteralPath $stagedDbModule))).AbsoluteUri
  & $nodeExe --input-type=module -e "await import(process.argv[1]);" $stagedDbUri
  if ($LASTEXITCODE -ne 0) { throw "The staged PennyWise database module could not load its generated Prisma client." }
} finally { Pop-Location }

$stagedTransientCache = Join-Path $stagedApp "node_modules\.cache"
if (Test-Path -LiteralPath $stagedTransientCache) {
  $expectedCacheRoot = [IO.Path]::GetFullPath((Join-Path $stagedApp "node_modules"))
  $resolvedTransientCache = [IO.Path]::GetFullPath($stagedTransientCache)
  if (-not $resolvedTransientCache.StartsWith($expectedCacheRoot + [IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to remove a cache path outside the staged application payload."
  }
  Remove-Item -LiteralPath $stagedTransientCache -Recurse -Force
}

$forbiddenWorkspacePayload = @(
  "node_modules\.cache",
  "node_modules\@clearledger\shared\src",
  "node_modules\@clearledger\accounting-core\src",
  "node_modules\@clearledger\db\src",
  "node_modules\@clearledger\db\generated-client-rebuilt"
)
foreach ($entry in $forbiddenWorkspacePayload) {
  if (Test-Path -LiteralPath (Join-Path $stagedApp $entry)) {
    throw "The deployment payload contains an obsolete workspace artifact: $entry"
  }
}

$webTarget = Join-Path $stage "resources\web"
New-Item -ItemType Directory -Path $webTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\web\serve.mjs") -Destination $webTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "apps\web\dist") -Destination $webTarget -Recurse

$nodeTarget = Join-Path $stage "resources\node"
New-Item -ItemType Directory -Path $nodeTarget -Force | Out-Null
Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $nodeTarget "node.exe")

$postgresTarget = Join-Path $stage "resources\postgresql"
New-Item -ItemType Directory -Path $postgresTarget -Force | Out-Null
foreach ($directory in @("bin", "lib", "share")) { Copy-Item -LiteralPath (Join-Path $postgresRoot $directory) -Destination $postgresTarget -Recurse }
if (Test-Path -LiteralPath (Join-Path $postgresRoot "symbols.txt")) { Copy-Item -LiteralPath (Join-Path $postgresRoot "symbols.txt") -Destination $postgresTarget }
$postgresManifest = @{
  schemaVersion = 1
  files = @(
    Get-ChildItem -LiteralPath $postgresTarget -File -Recurse |
      Sort-Object FullName |
      ForEach-Object {
        $relative = $_.FullName.Substring($postgresTarget.Length).TrimStart('\') -replace '\\', '/'
        @{ path = $relative; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
      }
  )
}
$postgresManifestJson = $postgresManifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
  (Join-Path $stage "resources\postgresql-runtime.json"),
  "$postgresManifestJson$([Environment]::NewLine)",
  (New-Object System.Text.UTF8Encoding($false))
)

$privateKey = Join-Path $buildRoot "qa-license-private.pem"
$publicKey = Join-Path $stage "resources\license-public-key.pem"
if (-not [string]::IsNullOrWhiteSpace($LicensePublicKeyPath)) {
  Copy-Item -LiteralPath $LicensePublicKeyPath -Destination $publicKey
} elseif ($SelfSign) {
  & $nodeExe -e "const{generateKeyPairSync}=require('crypto'),fs=require('fs');const{k1,k2}=(()=>{const{privateKey,publicKey}=generateKeyPairSync('ed25519');return{k1:privateKey.export({type:'pkcs8',format:'pem'}),k2:publicKey.export({type:'spki',format:'pem'})}})();fs.writeFileSync(process.argv[1],k1,{mode:0o600});fs.writeFileSync(process.argv[2],k2);" $privateKey $publicKey
  if ($LASTEXITCODE -ne 0) { throw "Could not generate the QA license key pair." }
} else {
  throw "A distribution package requires -LicensePublicKeyPath."
}
$licensePolicy = [ordered]@{
  schemaVersion = 1
  requireActivation = [bool]$RequireBeta20Activation
  requiredEdition = if ($RequireBeta20Activation) { "BETA_20" } else { $null }
  maxSlots = if ($RequireBeta20Activation) { 20 } else { $null }
}
[System.IO.File]::WriteAllText(
  (Join-Path $stage "resources\license-policy.json"),
  "$($licensePolicy | ConvertTo-Json)$([Environment]::NewLine)",
  (New-Object System.Text.UTF8Encoding($false))
)

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "launcher.cjs") -Destination (Join-Path $buildRoot "launcher.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "native-operations.cjs") -Destination (Join-Path $stage "resources\native-operations.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "offline-activation.cjs") -Destination (Join-Path $stage "resources\offline-activation.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "provision-beta.cjs") -Destination (Join-Path $stage "resources\provision-beta.cjs")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "application-activation.cs") -Destination (Join-Path $stage "resources\application-activation.cs")
$seaConfig = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "sea-config.json") -Raw) -replace '"main": "launcher.cjs"', ('"main": "' + ((Join-Path $buildRoot "launcher.cjs") -replace '\\','\\') + '"') -replace '"output": "build/sea-prep.blob"', ('"output": "' + ((Join-Path $buildRoot "sea-prep.blob") -replace '\\','\\') + '"')
$seaConfigPath = Join-Path $buildRoot "sea-config.json"
[System.IO.File]::WriteAllText($seaConfigPath, $seaConfig, (New-Object System.Text.UTF8Encoding($false)))
& $nodeExe --experimental-sea-config $seaConfigPath
if ($LASTEXITCODE -ne 0) { throw "Node could not create the launcher SEA blob." }
$launcherExe = Join-Path $stage "PennyWiseAccounting.exe"
Copy-Item -LiteralPath $nodeExe -Destination $launcherExe
& $signTool remove /s $launcherExe
if ($LASTEXITCODE -ne 0) { throw "SignTool could not remove the source Node signature before SEA injection." }
$postjectRoot = Join-Path $buildRoot "postject-tool"
$postjectPackage = Join-Path $postjectRoot "node_modules\postject\package.json"
$postjectCli = Join-Path $postjectRoot "node_modules\postject\dist\cli.js"
$postjectIsPinned = $false
if (Test-Path -LiteralPath $postjectPackage) {
  try {
    $postjectMetadata = Get-Content -LiteralPath $postjectPackage -Raw | ConvertFrom-Json
    $postjectIsPinned = $postjectMetadata.name -eq "postject" -and $postjectMetadata.version -eq "1.0.0-alpha.6" -and (Test-Path -LiteralPath $postjectCli)
  } catch {
    $postjectIsPinned = $false
  }
}
if (-not $postjectIsPinned) {
  & npm.cmd install --cache (Join-Path $buildRoot "npm-cache") --prefix $postjectRoot --no-save postject@1.0.0-alpha.6
  if ($LASTEXITCODE -ne 0) { throw "The pinned Postject build tool could not be restored." }
}
if (-not (Test-Path -LiteralPath $postjectCli)) { throw "The pinned Postject CLI is missing after restore." }
& $nodeExe $postjectCli $launcherExe NODE_SEA_BLOB (Join-Path $buildRoot "sea-prep.blob") --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite
if ($LASTEXITCODE -ne 0) { throw "Postject could not create PennyWiseAccounting.exe." }
foreach ($operationExe in @("PennyWiseActivation.exe", "PennyWiseBackup.exe", "PennyWiseRestore.exe", "PennyWiseDiagnostics.exe")) {
  Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $stage $operationExe)
}
@{
  schemaVersion = 1
  packageVersion = $Version
  publisher = $Publisher
  signing = if ($StageOnly) { "unpackaged-inno-pending" } elseif ($SelfSign) { "qa-self-signed" } else { "store-submission-unsigned" }
  builtAt = [DateTimeOffset]::UtcNow.ToString("o")
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $stage "resources\package-release.json") -Encoding UTF8

if ($StageOnly) {
  Write-Host "Staged native runtime: $stage"
  return
}

Add-Type -AssemblyName System.Drawing
function New-BrandAsset([string]$Path, [int]$Width, [int]$Height) {
  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(16, 40, 61))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(198, 105, 59)), ([Math]::Max(3, [Math]::Floor($Width / 28)))
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(247, 243, 237))
    $font = New-Object System.Drawing.Font "Segoe UI", ([Math]::Max(12, [Math]::Floor([Math]::Min($Width, $Height) * 0.28))), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $graphics.DrawEllipse($pen, $Width * 0.18, $Height * 0.18, $Width * 0.64, $Height * 0.64)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString("PW", $font, $brush, (New-Object System.Drawing.RectangleF 0, 0, $Width, $Height), $format)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
New-BrandAsset (Join-Path $stage "Assets\StoreLogo.png") 50 50
New-BrandAsset (Join-Path $stage "Assets\Square44x44Logo.png") 44 44
New-BrandAsset (Join-Path $stage "Assets\Square150x150Logo.png") 150 150
New-BrandAsset (Join-Path $stage "Assets\Wide310x150Logo.png") 310 150
New-BrandAsset (Join-Path $stage "Assets\Square310x310Logo.png") 310 310

$manifest = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "AppxManifest.template.xml") -Raw).Replace("__VERSION__", $Version).Replace("__PUBLISHER__", $Publisher)
Set-Content -LiteralPath (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding utf8

$packageName = "PennyWise-Accounting-$Version-x64.msix"
$packagePath = Join-Path $outputRoot $packageName
if (Test-Path -LiteralPath $packagePath) { throw 'Package version was created by another build. Refusing to overwrite.' }
& $makeAppx pack /d $stage /p $packagePath /o > $null 2>&1
if ($LASTEXITCODE -ne 0) { throw "MakeAppx failed." }

if ($SelfSign) {
  $certificate = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -eq $Publisher -and $_.EnhancedKeyUsageList.ObjectId -contains "1.3.6.1.5.5.7.3.3" } | Sort-Object NotAfter -Descending | Select-Object -First 1
  if (-not $certificate) {
    $certificate = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyUsage DigitalSignature -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(2) -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
  }
  $certificatePath = Join-Path $outputRoot "PennyWise-Accounting-QA.cer"
  Export-Certificate -Cert $certificate -FilePath $certificatePath -Force | Out-Null
  & $signTool sign /fd SHA256 /sha1 $certificate.Thumbprint /s My $packagePath
  if ($LASTEXITCODE -ne 0) { throw "SignTool failed." }
  & $signTool verify /pa /v $packagePath
  if ($LASTEXITCODE -ne 0) { Write-Warning "The QA package is signed but its self-signed certificate is not trusted on this build machine. Trust the exported .cer manually only on a controlled QA test machine." }
} else {
  Write-Warning "Store submission package created without a QA signature. Submit it with the Partner Center publisher identity; Microsoft Store signing remains required."
}

$hash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$packagePath.sha256" -Value "$hash  $packageName" -Encoding ascii
Write-Host "Built: $packagePath"
Write-Host "SHA-256: $hash"
if ($SelfSign) {
  Write-Host "QA certificate: $certificatePath"
  Write-Warning "This is a self-signed QA package. Public distribution requires Microsoft Store certification/signing."
} else {
  Write-Warning "This unsigned package is for Microsoft Store submission only. Do not sideload or distribute it directly."
}
