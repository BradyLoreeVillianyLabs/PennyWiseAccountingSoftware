[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$MsiPath,
  [string]$EvidenceDirectory,
  [switch]$KeepSentinels,
  [switch]$KeepWorkspaceOnFailure
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The ClearLedger MSI lifecycle drill can run only on Windows."
}

$qaDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$runId = [Guid]::NewGuid().ToString("N").Substring(0, 12)
$runTimestamp = [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
  $EvidenceDirectory = Join-Path $qaDirectory "evidence\msi-lifecycle-$runTimestamp-$runId"
}
$resolvedEvidenceDirectory = [IO.Path]::GetFullPath($EvidenceDirectory)
New-Item -ItemType Directory -Path $resolvedEvidenceDirectory -Force | Out-Null

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
$workspaceName = "ClearLedgerMsiQa-$runId"
$workspace = [IO.Path]::GetFullPath((Join-Path $temporaryBase $workspaceName))
if (-not $workspace.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($workspace) -ne $workspaceName) {
  throw "The isolated MSI QA workspace path is unsafe."
}
$workspacePrefix = $workspace.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
if ($resolvedEvidenceDirectory.Equals($workspace, [StringComparison]::OrdinalIgnoreCase) -or
    $resolvedEvidenceDirectory.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "EvidenceDirectory must be outside the disposable MSI QA workspace."
}
New-Item -ItemType Directory -Path $workspace -Force | Out-Null

$installLog = Join-Path $resolvedEvidenceDirectory "install.verbose.log"
$uninstallLog = Join-Path $resolvedEvidenceDirectory "uninstall.verbose.log"
$cleanupLog = Join-Path $resolvedEvidenceDirectory "cleanup-uninstall.verbose.log"
$textReport = Join-Path $resolvedEvidenceDirectory "MSI_LIFECYCLE_EVIDENCE.txt"
$jsonReport = Join-Path $resolvedEvidenceDirectory "MSI_LIFECYCLE_EVIDENCE.json"
$ownedFileReport = Join-Path $resolvedEvidenceDirectory "msi-owned-files-observed.txt"
$evidence = [Collections.Generic.List[string]]::new()
$terminalError = $null
$installedByQa = $false
$lifecycleSucceeded = $false
$productCode = $null
$artifactHash = $null
$productName = $null
$productVersion = $null
$observedOwnedFiles = @()
$customActionCount = $null
$removeFileRowCount = $null
$serviceTableRowCount = 0
$dockerBefore = $null
$dockerAfter = $null
$sentinelFiles = @()
$sentinelHashes = @{}
$installRoot = $null
$startMenuRoot = $null

function Add-Evidence([string]$Message) {
  $line = "$([DateTimeOffset]::UtcNow.ToString('u')) $Message"
  $script:evidence.Add($line)
  Write-Host $Message
}

function Release-ComObject([object]$ComObject) {
  if ($null -ne $ComObject -and [Runtime.InteropServices.Marshal]::IsComObject($ComObject)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ComObject)
  }
}

function Invoke-ComMethod([object]$ComObject, [string]$Name, [object[]]$Arguments = @()) {
  return $ComObject.GetType().InvokeMember(
    $Name,
    [Reflection.BindingFlags]::InvokeMethod,
    $null,
    $ComObject,
    $Arguments
  )
}

function Get-ComIndexedProperty([object]$ComObject, [string]$Name, [object[]]$Arguments) {
  return $ComObject.GetType().InvokeMember(
    $Name,
    [Reflection.BindingFlags]::GetProperty,
    $null,
    $ComObject,
    $Arguments
  )
}

function Invoke-MsiQuery(
  [object]$Database,
  [string]$Query,
  [string[]]$Columns
) {
  $rows = [Collections.Generic.List[object]]::new()
  $view = Invoke-ComMethod $Database "OpenView" @($Query)
  try {
    [void](Invoke-ComMethod $view "Execute")
    while ($true) {
      $record = Invoke-ComMethod $view "Fetch"
      if ($null -eq $record) { break }
      try {
        $row = [ordered]@{}
        for ($index = 0; $index -lt $Columns.Count; $index += 1) {
          $row[$Columns[$index]] = [string](Get-ComIndexedProperty $record "StringData" @($index + 1))
        }
        $rows.Add([pscustomobject]$row)
      } finally {
        Release-ComObject $record
      }
    }
  } finally {
    try { [void](Invoke-ComMethod $view "Close") } catch {}
    Release-ComObject $view
  }
  return $rows.ToArray()
}

function Get-InstallFileSnapshot([string]$Root) {
  $snapshot = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return $snapshot }
  $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
  foreach ($file in Get-ChildItem -LiteralPath $Root -File -Recurse -Force) {
    $fullPath = [IO.Path]::GetFullPath($file.FullName)
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "A file resolved outside the expected install root: $fullPath"
    }
    $relativePath = $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
    $snapshot[$relativePath] = $fullPath
  }
  return $snapshot
}

function Get-DockerClientSnapshot {
  $command = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) {
    return [pscustomobject]@{
      present = $false
      path = $null
      sha256 = $null
      length = $null
    }
  }
  $path = [IO.Path]::GetFullPath($command.Source)
  return [pscustomobject]@{
    present = $true
    path = $path
    sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    length = (Get-Item -LiteralPath $path).Length
  }
}

function Assert-DockerClientUnchanged([object]$Before, [object]$After) {
  if ($Before.present -ne $After.present) {
    throw "Docker client presence changed during the MSI lifecycle."
  }
  if ($Before.present -and
      (-not ([string]$Before.path).Equals([string]$After.path, [StringComparison]::OrdinalIgnoreCase) -or
       [string]$Before.sha256 -ne [string]$After.sha256 -or
       [long]$Before.length -ne [long]$After.length)) {
    throw "The Docker client path or file identity changed during the MSI lifecycle."
  }
}

function Get-ProductState([string]$Code) {
  return [ClearLedger.MsiQa.NativeMethods]::MsiQueryProductState($Code)
}

function Invoke-MsiExec(
  [ValidateSet("Install", "Uninstall")]
  [string]$Mode,
  [string]$Target,
  [string]$LogPath
) {
  $msiexec = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) "msiexec.exe"
  if (-not (Test-Path -LiteralPath $msiexec -PathType Leaf)) {
    throw "Windows Installer was not found at the expected system path: $msiexec"
  }
  $operation = if ($Mode -eq "Install") { "/i" } else { "/x" }
  $arguments = @(
    $operation,
    "`"$Target`"",
    "/qn",
    "/norestart",
    "/L*v",
    "`"$LogPath`""
  )
  $process = Start-Process -FilePath $msiexec -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Windows Installer $Mode failed with exit code $($process.ExitCode). See $LogPath"
  }
  return $process.ExitCode
}

function Assert-NoProhibitedMsiActivity([string]$LogPath, [string]$Phase) {
  if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
    throw "The $Phase verbose MSI log was not produced: $LogPath"
  }
  $prohibitedPatterns = @(
    '(?i)\bdocker(?:\.exe)?\s+(?:compose\s+down|volume\s+rm|image\s+rm|system\s+prune|rm\b)',
    '(?i)\b(?:winget|choco(?:latey)?)\b[^\r\n]*\bdocker\b',
    '(?i)Uninstall-ClearLedger\.ps1[^\r\n]*-DeleteData',
    '(?i)CustomAction[^\r\n]*(?:docker|delete.?data|remove.?volume)'
  )
  foreach ($pattern in $prohibitedPatterns) {
    $match = Select-String -LiteralPath $LogPath -Pattern $pattern | Select-Object -First 1
    if ($match) {
      throw "The $Phase MSI log contains a prohibited Docker/data-removal command pattern at line $($match.LineNumber)."
    }
  }
}

function Get-ShortcutDetails([string]$ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  try {
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    try {
      return [pscustomobject]@{
        targetPath = [string]$shortcut.TargetPath
        arguments = [string]$shortcut.Arguments
        workingDirectory = [string]$shortcut.WorkingDirectory
      }
    } finally {
      Release-ComObject $shortcut
    }
  } finally {
    Release-ComObject $shell
  }
}

function Assert-SentinelFilesUnchanged {
  foreach ($sentinel in $script:sentinelFiles) {
    if (-not (Test-Path -LiteralPath $sentinel -PathType Leaf)) {
      throw "An MSI lifecycle operation removed the precreated sentinel: $sentinel"
    }
    $currentHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($currentHash -ne $script:sentinelHashes[$sentinel]) {
      throw "An MSI lifecycle operation changed the precreated sentinel: $sentinel"
    }
  }
}

function Remove-VerifiedSentinels {
  foreach ($sentinel in $script:sentinelFiles) {
    if (Test-Path -LiteralPath $sentinel -PathType Leaf) {
      $currentHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($currentHash -ne $script:sentinelHashes[$sentinel]) {
        throw "Refusing to clean a sentinel whose contents changed: $sentinel"
      }
      Remove-Item -LiteralPath $sentinel -Force
    }
  }
  $backupDirectory = Join-Path $script:installRoot "Backups"
  if ((Test-Path -LiteralPath $backupDirectory -PathType Container) -and
      @(Get-ChildItem -LiteralPath $backupDirectory -Force).Count -eq 0) {
    Remove-Item -LiteralPath $backupDirectory -Force
  }
  if ((Test-Path -LiteralPath $script:installRoot -PathType Container) -and
      @(Get-ChildItem -LiteralPath $script:installRoot -Force).Count -eq 0) {
    Remove-Item -LiteralPath $script:installRoot -Force
  }
}

if (-not ("ClearLedger.MsiQa.NativeMethods" -as [type])) {
  Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;

namespace ClearLedger.MsiQa
{
    public static class NativeMethods
    {
        [DllImport("msi.dll", CharSet = CharSet.Unicode)]
        public static extern int MsiQueryProductState(string productCode);
    }
}
"@
}

try {
  $resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
  if (-not (Test-Path -LiteralPath $resolvedMsi -PathType Leaf)) {
    throw "The explicit MSI path does not name a file: $resolvedMsi"
  }
  $msiFileName = [IO.Path]::GetFileName($resolvedMsi)
  if ($msiFileName -match 'UNVERIFIED' -or
      $msiFileName -notmatch '^ClearLedger-Public-Beta-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?-x64\.msi$') {
    throw "The lifecycle drill accepts only an explicit ClearLedger-Public-Beta-<version>-x64.msi artifact."
  }

  $checksumPath = "$resolvedMsi.sha256"
  if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
    throw "The MSI must have a sibling .msi.sha256 file: $checksumPath"
  }
  $checksumLines = @(
    Get-Content -LiteralPath $checksumPath |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
  if ($checksumLines.Count -ne 1 -or
      $checksumLines[0] -notmatch '^(?<Hash>[a-fA-F0-9]{64})[ \t]{2}(?<Name>[^\\/:]+)$') {
    throw "The MSI checksum must contain exactly: <64 hex characters><two spaces><MSI filename>."
  }
  if (-not ([string]$Matches.Name).Equals($msiFileName, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The sibling checksum names another MSI: $($Matches.Name)"
  }
  $artifactHash = (Get-FileHash -LiteralPath $resolvedMsi -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $artifactHash.Equals([string]$Matches.Hash, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The MSI does not match its sibling SHA-256."
  }
  Add-Evidence "Artifact SHA-256 verified: $artifactHash"

  $signature = Get-AuthenticodeSignature -LiteralPath $resolvedMsi
  Add-Evidence "Authenticode status recorded (not changed by this drill): $($signature.Status)"

  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $null
  try {
    $database = Invoke-ComMethod $installer "OpenDatabase" @($resolvedMsi, 0)
    $propertyRows = @(Invoke-MsiQuery $database 'SELECT `Property`, `Value` FROM `Property`' @("Property", "Value"))
    $properties = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in $propertyRows) { $properties[$row.Property] = $row.Value }
    foreach ($requiredProperty in @("ProductCode", "ProductName", "ProductVersion", "Manufacturer")) {
      if (-not $properties.ContainsKey($requiredProperty)) {
        throw "The MSI Property table is missing $requiredProperty."
      }
    }
    $parsedProductCode = [Guid]::Empty
    if (-not [Guid]::TryParse($properties["ProductCode"], [ref]$parsedProductCode)) {
      throw "The MSI ProductCode is not a GUID."
    }
    $productCode = $parsedProductCode.ToString("B").ToUpperInvariant()
    $productName = $properties["ProductName"]
    $productVersion = $properties["ProductVersion"]
    if ($productName -ne "ClearLedger Public Beta" -or $properties["Manufacturer"] -ne "ClearLedger") {
      throw "The MSI identity is not the expected ClearLedger Public Beta product."
    }
    if ($properties.ContainsKey("ALLUSERS") -and $properties["ALLUSERS"] -eq "1") {
      throw "The MSI declares a per-machine ALLUSERS scope; this drill accepts only the per-user package."
    }

    $tableRows = @(Invoke-MsiQuery $database 'SELECT `Name` FROM `_Tables`' @("Name"))
    $tables = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($row in $tableRows) { [void]$tables.Add($row.Name) }

    $customActions = @()
    if ($tables.Contains("CustomAction")) {
      $customActions = @(Invoke-MsiQuery $database 'SELECT `Action`, `Type`, `Source`, `Target` FROM `CustomAction`' @("Action", "Type", "Source", "Target"))
    }
    $customActionCount = $customActions.Count
    if ($customActionCount -ne 0) {
      $actionNames = ($customActions | ForEach-Object { $_.Action }) -join ", "
      throw "The MSI contains custom actions ($actionNames). ClearLedger's safe wrapper must contain none."
    }

    foreach ($serviceTable in @("ServiceInstall", "ServiceControl")) {
      if ($tables.Contains($serviceTable)) {
        $serviceRows = @(Invoke-MsiQuery $database "SELECT ``$serviceTable`` FROM ``$serviceTable``" @("Key"))
        $serviceTableRowCount += $serviceRows.Count
      }
    }
    if ($serviceTableRowCount -ne 0) {
      throw "The MSI contains service installation or service-control rows."
    }

    $removeFileRows = @()
    if ($tables.Contains("RemoveFile")) {
      $removeFileRows = @(Invoke-MsiQuery $database 'SELECT `FileKey`, `Component_`, `FileName`, `DirProperty`, `InstallMode` FROM `RemoveFile`' @("FileKey", "Component", "FileName", "Directory", "InstallMode"))
    }
    $removeFileRowCount = $removeFileRows.Count
    $fileDeletionRows = @($removeFileRows | Where-Object { -not [string]::IsNullOrWhiteSpace($_.FileName) })
    if ($fileDeletionRows.Count -ne 0) {
      throw "The MSI RemoveFile table contains file or wildcard deletion rows; only empty-directory removal is accepted."
    }
    if ($tables.Contains("RemoveRegistry")) {
      $removeRegistryRows = @(Invoke-MsiQuery $database 'SELECT `RemoveRegistry`, `Root`, `Key`, `Name`, `Component_` FROM `RemoveRegistry`' @("Id", "Root", "Key", "Name", "Component"))
      if ($removeRegistryRows.Count -ne 0) {
        throw "The MSI contains explicit RemoveRegistry rows outside normal MSI-owned value removal."
      }
    }
  } finally {
    Release-ComObject $database
    Release-ComObject $installer
  }
  Add-Evidence "MSI identity verified: $productName $productVersion ($productCode)."
  Add-Evidence "Static safety verified: zero custom actions, zero service actions, and no RemoveFile file/wildcard rows."

  $preInstallProductState = Get-ProductState $productCode
  if ($preInstallProductState -notin @(-1, 2)) {
    throw "Product $productCode is already registered for this user (state $preInstallProductState); refusing to alter it."
  }

  $localApplicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  $programsFolder = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
  if ([string]::IsNullOrWhiteSpace($localApplicationData) -or [string]::IsNullOrWhiteSpace($programsFolder)) {
    throw "The current user's Local AppData or Start Menu Programs folder could not be resolved."
  }
  $installRoot = [IO.Path]::GetFullPath((Join-Path $localApplicationData "Programs\ClearLedger Public Beta"))
  $startMenuRoot = [IO.Path]::GetFullPath((Join-Path $programsFolder "ClearLedger Public Beta"))
  foreach ($collision in @($installRoot, $startMenuRoot)) {
    if (Test-Path -LiteralPath $collision) {
      throw "A ClearLedger path already exists; refusing to overwrite or merge with it: $collision"
    }
  }
  foreach ($registryPath in @(
    "Registry::HKEY_CURRENT_USER\Software\ClearLedger\PublicBeta\Installer",
    "Registry::HKEY_CURRENT_USER\Software\ClearLedger\PublicBeta\InstallerFiles"
  )) {
    if (Test-Path -LiteralPath $registryPath) {
      throw "ClearLedger installer registry state already exists; refusing to merge with it: $registryPath"
    }
  }

  $backupRoot = Join-Path $installRoot "Backups"
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $sentinelFiles = @(
    (Join-Path $installRoot "beta.env"),
    (Join-Path $installRoot ".license-accepted"),
    (Join-Path $backupRoot "ClearLedger-QA-Preserve-$runId.txt")
  )
  $sentinelContents = @(
    "# ClearLedger MSI lifecycle QA state sentinel`r`nCLEARLEDGER_MSI_QA_SENTINEL=$runId`r`n",
    "ClearLedger MSI lifecycle QA license-state sentinel $runId`r`n",
    "ClearLedger MSI lifecycle QA backup sentinel $runId`r`n"
  )
  for ($index = 0; $index -lt $sentinelFiles.Count; $index += 1) {
    [IO.File]::WriteAllText($sentinelFiles[$index], $sentinelContents[$index], (New-Object Text.UTF8Encoding($false)))
    $sentinelHashes[$sentinelFiles[$index]] = (Get-FileHash -LiteralPath $sentinelFiles[$index] -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $preInstallFiles = Get-InstallFileSnapshot $installRoot
  if ($preInstallFiles.Count -ne $sentinelFiles.Count) {
    throw "The isolated pre-install folder contains files other than the three QA sentinels."
  }
  Add-Evidence "Created three uniquely identified, non-runnable state/backup sentinels before installation."

  $dockerBefore = Get-DockerClientSnapshot
  if ($dockerBefore.present) {
    Add-Evidence "Recorded the existing Docker client path and SHA-256 without querying or changing Docker resources."
  } else {
    Add-Evidence "No Docker client was present before installation; the MSI drill does not install one."
  }

  $installExitCode = Invoke-MsiExec -Mode Install -Target $resolvedMsi -LogPath $installLog
  $installedByQa = $true
  Add-Evidence "Quiet per-user install completed with Windows Installer exit code $installExitCode."

  $installedProductState = Get-ProductState $productCode
  if ($installedProductState -ne 5) {
    throw "The MSI did not reach the Windows Installer default/local product state (found $installedProductState)."
  }
  if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) {
    throw "The expected per-user install folder was not created: $installRoot"
  }
  $postInstallFiles = Get-InstallFileSnapshot $installRoot
  $observedOwnedFiles = @(
    $postInstallFiles.Keys |
      Where-Object { -not $preInstallFiles.ContainsKey($_) } |
      Sort-Object
  )
  if ($observedOwnedFiles.Count -lt 1) {
    throw "No MSI-owned files were observed after installation."
  }
  $expectedInstalledFiles = @(
    "release-manifest.json",
    "INSTALL_WINDOWS.md",
    "Start-ClearLedger.ps1",
    "Diagnose-ClearLedger.ps1",
    "Backup-ClearLedger.ps1",
    "Uninstall-ClearLedger.ps1",
    "compose.yaml",
    "clearledger-public-beta-image.tar",
    "SHA256SUMS.txt"
  )
  foreach ($relativePath in $expectedInstalledFiles) {
    if (-not $postInstallFiles.ContainsKey($relativePath) -or $preInstallFiles.ContainsKey($relativePath)) {
      throw "The installed per-user payload is missing expected MSI-owned file: $relativePath"
    }
  }
  [IO.File]::WriteAllLines($ownedFileReport, $observedOwnedFiles, (New-Object Text.UTF8Encoding($false)))
  Assert-SentinelFilesUnchanged
  Add-Evidence "Verified $($observedOwnedFiles.Count) newly installed files, including all required runtime entrypoints."

  $shortcutContracts = @(
    [pscustomobject]@{ Name = "Start ClearLedger.lnk"; Target = "powershell.exe"; Argument = "Start-ClearLedger.ps1" },
    [pscustomobject]@{ Name = "Diagnose ClearLedger.lnk"; Target = "powershell.exe"; Argument = "Diagnose-ClearLedger.ps1" },
    [pscustomobject]@{ Name = "Backup ClearLedger.lnk"; Target = "powershell.exe"; Argument = "Backup-ClearLedger.ps1" },
    [pscustomobject]@{ Name = "Uninstall ClearLedger (keep Docker data).lnk"; Target = "msiexec.exe"; Argument = $productCode }
  )
  foreach ($contract in $shortcutContracts) {
    $shortcutPath = Join-Path $startMenuRoot $contract.Name
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
      throw "The expected per-user Start Menu shortcut is missing: $shortcutPath"
    }
    $details = Get-ShortcutDetails $shortcutPath
    if ([IO.Path]::GetFileName($details.targetPath) -ne $contract.Target -or
        $details.arguments.IndexOf($contract.Argument, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        -not $details.workingDirectory.Equals($installRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "The Start Menu shortcut does not match its safe per-user contract: $shortcutPath"
    }
  }
  Add-Evidence "Verified four expected per-user Start Menu shortcuts and their targets/arguments."

  Assert-NoProhibitedMsiActivity $installLog "install"
  $dockerAfterInstall = Get-DockerClientSnapshot
  Assert-DockerClientUnchanged $dockerBefore $dockerAfterInstall
  Add-Evidence "Install log and Docker-client identity show no Docker installation or destructive Docker command."

  $uninstallExitCode = Invoke-MsiExec -Mode Uninstall -Target $productCode -LogPath $uninstallLog
  $installedByQa = $false
  Add-Evidence "Quiet uninstall by ProductCode completed with Windows Installer exit code $uninstallExitCode."

  $uninstalledProductState = Get-ProductState $productCode
  if ($uninstalledProductState -notin @(-1, 2)) {
    throw "ProductCode remains registered after uninstall (state $uninstalledProductState)."
  }
  foreach ($relativePath in $observedOwnedFiles) {
    $ownedPath = Join-Path $installRoot $relativePath.Replace('/', '\')
    if (Test-Path -LiteralPath $ownedPath) {
      throw "An MSI-owned file remains after uninstall: $ownedPath"
    }
  }
  foreach ($contract in $shortcutContracts) {
    $shortcutPath = Join-Path $startMenuRoot $contract.Name
    if (Test-Path -LiteralPath $shortcutPath) {
      throw "An MSI-owned shortcut remains after uninstall: $shortcutPath"
    }
  }
  Assert-SentinelFilesUnchanged
  Add-Evidence "All observed MSI-owned files and shortcuts were removed; all state/backup sentinels survived byte-for-byte."

  Assert-NoProhibitedMsiActivity $uninstallLog "uninstall"
  $dockerAfter = Get-DockerClientSnapshot
  Assert-DockerClientUnchanged $dockerBefore $dockerAfter
  Add-Evidence "Uninstall log and Docker-client identity show no Docker installation, invocation, or data-removal command."

  foreach ($registryPath in @(
    "Registry::HKEY_CURRENT_USER\Software\ClearLedger\PublicBeta\Installer",
    "Registry::HKEY_CURRENT_USER\Software\ClearLedger\PublicBeta\InstallerFiles"
  )) {
    if (Test-Path -LiteralPath $registryPath) {
      $remainingValues = @(
        (Get-ItemProperty -LiteralPath $registryPath).PSObject.Properties |
          Where-Object { $_.Name -notmatch '^PS(?:Path|ParentPath|ChildName|Drive|Provider)$' }
      )
      if ($remainingValues.Count -ne 0) {
        throw "MSI-owned installer registry values remain after uninstall: $registryPath"
      }
    }
  }
  Add-Evidence "MSI-owned current-user registry values were removed."

  $lifecycleSucceeded = $true
  Add-Evidence "PASS: ClearLedger per-user MSI lifecycle and preservation boundaries verified."
} catch {
  $terminalError = $_
  Add-Evidence "FAIL: $($_.Exception.Message)"
} finally {
  if ($installedByQa -and $productCode) {
    try {
      $cleanupExitCode = Invoke-MsiExec -Mode Uninstall -Target $productCode -LogPath $cleanupLog
      $installedByQa = $false
      Add-Evidence "Failure cleanup removed only the QA-installed ProductCode (exit code $cleanupExitCode)."
    } catch {
      Add-Evidence "WARNING: exact ProductCode cleanup failed: $($_.Exception.Message)"
    }
  }

  if ($lifecycleSucceeded -and -not $KeepSentinels) {
    try {
      Remove-VerifiedSentinels
      Add-Evidence "Removed only the three verified QA sentinels and now-empty QA-created directories."
    } catch {
      $lifecycleSucceeded = $false
      if ($null -eq $terminalError) { $terminalError = $_ }
      Add-Evidence "FAIL: exact sentinel cleanup could not complete safely: $($_.Exception.Message)"
    }
  } elseif ($sentinelFiles.Count -gt 0) {
    Add-Evidence "Sentinels retained for inspection: $($sentinelFiles -join '; ')"
  }

  $result = [ordered]@{
    schemaVersion = 1
    runId = $runId
    status = if ($lifecycleSucceeded -and $null -eq $terminalError) { "PASS" } else { "FAIL" }
    artifact = [ordered]@{
      path = if ($resolvedMsi) { $resolvedMsi } else { $MsiPath }
      sha256 = $artifactHash
      productName = $productName
      productVersion = $productVersion
      productCode = $productCode
    }
    scope = [ordered]@{
      installRoot = $installRoot
      startMenuRoot = $startMenuRoot
      currentUser = [Environment]::UserName
    }
    staticSafety = [ordered]@{
      customActionCount = $customActionCount
      serviceActionCount = $serviceTableRowCount
      removeFileRowCount = $removeFileRowCount
    }
    installedFileCountObserved = $observedOwnedFiles.Count
    preservation = [ordered]@{
      sentinelCount = $sentinelFiles.Count
      survivedUninstall = $lifecycleSucceeded
      retainedAfterDrill = [bool]($KeepSentinels -or -not $lifecycleSucceeded)
    }
    dockerClient = [ordered]@{
      presentBefore = if ($dockerBefore) { $dockerBefore.present } else { $null }
      presentAfter = if ($dockerAfter) { $dockerAfter.present } else { $null }
      unchanged = if ($dockerBefore -and $dockerAfter) {
        $dockerBefore.present -eq $dockerAfter.present -and
          (-not $dockerBefore.present -or
           ([string]$dockerBefore.path).Equals([string]$dockerAfter.path, [StringComparison]::OrdinalIgnoreCase) -and
           [string]$dockerBefore.sha256 -eq [string]$dockerAfter.sha256)
      } else { $null }
      engineOrResourcesQueried = $false
    }
    logs = [ordered]@{
      install = $installLog
      uninstall = $uninstallLog
      cleanupUninstall = if (Test-Path -LiteralPath $cleanupLog) { $cleanupLog } else { $null }
      ownedFiles = if (Test-Path -LiteralPath $ownedFileReport) { $ownedFileReport } else { $null }
    }
    failure = if ($terminalError) { $terminalError.Exception.Message } else { $null }
  }
  [IO.File]::WriteAllText($textReport, (($evidence -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($jsonReport, (($result | ConvertTo-Json -Depth 8) + "`r`n"), (New-Object Text.UTF8Encoding($false)))

  $keepWorkspace = -not $lifecycleSucceeded -and $KeepWorkspaceOnFailure
  if ($keepWorkspace) {
    Add-Evidence "Disposable workspace retained for failure inspection: $workspace"
    [IO.File]::WriteAllText($textReport, (($evidence -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  } elseif (Test-Path -LiteralPath $workspace -PathType Container) {
    $validatedWorkspace = [IO.Path]::GetFullPath($workspace)
    if (-not $validatedWorkspace.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($validatedWorkspace) -ne $workspaceName) {
      throw "Refusing to remove an unvalidated MSI QA workspace."
    }
    Remove-Item -LiteralPath $validatedWorkspace -Recurse -Force
  }

  Write-Host "MSI lifecycle evidence: $textReport"
  Write-Host "Structured evidence: $jsonReport"
}

if ($null -ne $terminalError) {
  throw $terminalError
}
