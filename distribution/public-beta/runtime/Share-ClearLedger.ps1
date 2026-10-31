[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string]$OrganizationId,
  [Parameter(Mandatory = $true)]
  [string]$Subdomain,
  [string]$DisplayName,
  [string]$Username = "viewer",
  [string]$Password,
  [Alias("LocalPort")]
  [ValidateRange(1024, 65535)]
  [int]$SharePort = 3100,
  [switch]$Reserved
)

$ErrorActionPreference = "Stop"
$runtimeDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $runtimeDirectory "Compose-Compatibility.ps1")
$composePath = Join-Path $runtimeDirectory "compose.yaml"
$shareComposePath = Join-Path $runtimeDirectory "compose.share.yaml"
$environmentPath = Join-Path $runtimeDirectory "beta.env"
$startScript = Join-Path $runtimeDirectory "Start-ClearLedger.ps1"
$stopShareScript = Join-Path $runtimeDirectory "Stop-ClearLedgerShare.ps1"
$shareStatePath = Join-Path $runtimeDirectory ".share-state.json"
$Email = $Email.Trim().ToLowerInvariant()
$OrganizationId = if ([string]::IsNullOrWhiteSpace($OrganizationId)) {
  ""
} else {
  $OrganizationId.Trim().ToLowerInvariant()
}
$Subdomain = $Subdomain.Trim().ToLowerInvariant()
$DisplayName = if ([string]::IsNullOrWhiteSpace($DisplayName)) { $Email } else { $DisplayName.Trim() }
$Username = $Username.Trim()

function Get-ClearLedgerComposeProjectName([string]$Path) {
  $projectLines = @(
    Get-Content -LiteralPath $Path |
      Where-Object { $_.TrimStart([char]0xFEFF) -match '^CLEARLEDGER_COMPOSE_PROJECT_NAME=(.*)$' }
  )
  if ($projectLines.Count -gt 1) { throw "beta.env contains duplicate CLEARLEDGER_COMPOSE_PROJECT_NAME entries." }
  $projectName = if ($projectLines.Count -eq 1) {
    [regex]::Match(
      $projectLines[0].TrimStart([char]0xFEFF),
      '^CLEARLEDGER_COMPOSE_PROJECT_NAME=(.*)$'
    ).Groups[1].Value
  } else {
    "clearledger-beta"
  }
  if ($projectName -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') {
    throw "beta.env contains an invalid CLEARLEDGER_COMPOSE_PROJECT_NAME."
  }
  return $projectName
}

if ($Email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw "Email must be a valid address for the dedicated beta tester."
}
if ($OrganizationId -and $OrganizationId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
  throw "OrganizationId must be the UUID of the one company being shared."
}
if ($Subdomain -notmatch '^[a-z0-9]{3,63}$') {
  throw "Subdomain must contain 3-63 lowercase letters or numbers (LocalXpose temporary-domain format)."
}
if ($Username -notmatch '^[A-Za-z0-9]{3,64}$') {
  throw "Username must contain 3-64 letters or numbers (LocalXpose Basic Auth format)."
}
if ($DisplayName.Length -gt 200) { throw "DisplayName cannot exceed 200 characters." }
if ($DisplayName -match '[\x00-\x1f\x7f]') { throw "DisplayName cannot contain control characters." }
if ($Password -and ($Password.Length -lt 20 -or
    $Password.Length -gt 128 -or
    $Password -notmatch '^[A-Za-z0-9]+$')) {
  throw "Password must contain 20-128 letters or numbers (LocalXpose Basic Auth format)."
}

function New-ClearLedgerSharePassword {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

if (-not $Password) { $Password = New-ClearLedgerSharePassword }
$loclxCommand = Get-Command loclx.exe -ErrorAction SilentlyContinue
if (-not $loclxCommand) { $loclxCommand = Get-Command loclx -ErrorAction SilentlyContinue }
if (-not $loclxCommand) {
  throw "LocalXpose is required. Install and sign in to loclx, then run this script again."
}
foreach ($requiredPath in @($composePath, $shareComposePath, $startScript, $stopShareScript)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "The ClearLedger package is incomplete. Missing $([IO.Path]::GetFileName($requiredPath))."
  }
}

# End only a tunnel previously recorded by this package. The stop script validates
# the executable and exact target before touching a process, so unrelated Loclx
# tunnels (including operational integrations) remain untouched.
& $stopShareScript -Quiet

$listener = Get-NetTCPConnection -State Listen -LocalPort $SharePort -ErrorAction SilentlyContinue
if ($listener) {
  $ownerIds = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
  throw "The protected share needs local port $SharePort, which is used by process $ownerIds. Choose another -SharePort."
}

Write-Host "Ensuring the verified local ClearLedger installation is ready..."
& $startScript -AcceptLicense -NoBrowser
$composeProjectName = Get-ClearLedgerComposeProjectName $environmentPath

$ownerLocalPort = 3000
$ownerPortLines = @(
  Get-Content -LiteralPath $environmentPath |
    Where-Object { $_ -match '^CLEARLEDGER_LOCAL_PORT=(.+)$' }
)
if ($ownerPortLines.Count -gt 1) { throw "beta.env contains duplicate CLEARLEDGER_LOCAL_PORT entries." }
if ($ownerPortLines.Count -eq 1) {
  $ownerPortValue = [regex]::Match($ownerPortLines[0], '^CLEARLEDGER_LOCAL_PORT=(.+)$').Groups[1].Value
  $parsedOwnerLocalPort = 0
  if (-not [int]::TryParse($ownerPortValue, [ref]$parsedOwnerLocalPort) -or
      $parsedOwnerLocalPort -lt 1024 -or
      $parsedOwnerLocalPort -gt 65535) {
    throw "The installed CLEARLEDGER_LOCAL_PORT is invalid."
  }
  $ownerLocalPort = $parsedOwnerLocalPort
}

$membershipResponse = Invoke-RestMethod `
  -Uri "http://127.0.0.1:$ownerLocalPort/api/v1/organizations" `
  -Headers @{
    "x-clearledger-user-email" = $Email
    "x-clearledger-user-name" = $DisplayName
    "x-clearledger-email-verified" = "true"
  } `
  -TimeoutSec 10
$memberships = @($membershipResponse.organizations)
if ($memberships.Count -eq 0) {
  throw "The tester is not an active member of any company. Invite and accept the tester locally before sharing."
}
if ($OrganizationId) {
  $selectedMembership = $memberships | Where-Object { $_.organizationId -eq $OrganizationId }
  if (-not $selectedMembership) {
    throw "The tester is not an active member of the requested company."
  }
} elseif ($memberships.Count -eq 1) {
  $selectedMembership = $memberships[0]
  $OrganizationId = [string]$selectedMembership.organizationId
} else {
  Write-Host "Choose the one company this tester may access:"
  for ($index = 0; $index -lt $memberships.Count; $index += 1) {
    Write-Host "[$($index + 1)] $($memberships[$index].displayName) ($($memberships[$index].role))"
  }
  $selection = Read-Host "Company number"
  $selectionNumber = 0
  if (-not [int]::TryParse($selection, [ref]$selectionNumber) -or
      $selectionNumber -lt 1 -or
      $selectionNumber -gt $memberships.Count) {
    throw "No valid company was selected. Remote access was not started."
  }
  $selectedMembership = $memberships[$selectionNumber - 1]
  $OrganizationId = [string]$selectedMembership.organizationId
}

$shareVariables = @{
  CLEARLEDGER_SHARE_EMAIL = $Email
  CLEARLEDGER_SHARE_NAME = $DisplayName
  CLEARLEDGER_SHARE_ORGANIZATION_ID = $OrganizationId
  CLEARLEDGER_SHARE_SUBDOMAIN = $Subdomain
  CLEARLEDGER_SHARE_PORT = $SharePort.ToString()
}
$previousVariables = @{}
foreach ($entry in $shareVariables.GetEnumerator()) {
  $previousVariables[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
  [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
}

$composeArguments = @(
  "compose",
  "--project-name", $composeProjectName,
  "--env-file", $environmentPath,
  "--file", $composePath,
  "--file", $shareComposePath
)
$shareCleanupNeeded = $false
$tunnelProcess = $null
try {
  Set-Location -LiteralPath $runtimeDirectory
  # Docker Compose can create one service before a later service fails. Mark cleanup
  # as required before invoking it so partial startup never leaves a loopback share.
  $shareCleanupNeeded = $true
  Write-Host "Starting the isolated one-company share services..."
  Invoke-ClearLedgerCompose @composeArguments up --detach share_api share_web
  if ($LASTEXITCODE -ne 0) { throw "The isolated share services did not start." }

  Write-Host "Waiting up to two minutes for the protected local share to become ready..."
  $shareReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    try {
      $organizations = Invoke-RestMethod -Uri "http://127.0.0.1:$SharePort/api/v1/organizations" -TimeoutSec 3
      $membership = @($organizations.organizations) |
        Where-Object { $_.organizationId -eq $OrganizationId }
      if (-not $membership) {
        throw "The tester is not an active member of the selected company. Invite and accept the tester locally before sharing."
      }
      $shareReady = $true
      break
    } catch {
      if ($_.Exception.Message -like "The tester is not an active member*") { throw }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $shareReady) { throw "The protected share did not become ready within two minutes." }

  $publicUrl = "https://$Subdomain.loclx.io"
  $tunnelArguments = @(
    "tunnel", "http",
    "--to", "127.0.0.1:$SharePort",
    $(if ($Reserved) { "--reserved-domain" } else { "--subdomain" }),
    $(if ($Reserved) { "$Subdomain.loclx.io" } else { $Subdomain }),
    "--basic-auth", "${Username}:${Password}",
    "--rate-limit", "20",
    "--https-redirect"
  )
  $tunnelProcess = Start-Process `
    -FilePath $loclxCommand.Source `
    -ArgumentList $tunnelArguments `
    -NoNewWindow `
    -PassThru
  if (-not $tunnelProcess -or $tunnelProcess.Id -lt 1) {
    throw "LocalXpose could not be started."
  }
  $shareState = [ordered]@{
    schema = "clearledger-share-state-v1"
    processId = $tunnelProcess.Id
    executablePath = [IO.Path]::GetFullPath($loclxCommand.Source)
    localPort = $SharePort
    subdomain = $Subdomain
    reserved = [bool]$Reserved
    startedAt = [DateTimeOffset]::Now.ToString("o")
  }
  $temporaryStatePath = "$shareStatePath.$PID.tmp"
  try {
    [IO.File]::WriteAllText($temporaryStatePath, ($shareState | ConvertTo-Json -Depth 3))
    if (Test-Path -LiteralPath $shareStatePath -PathType Leaf) {
      throw "A packaged share state appeared while the tunnel was starting."
    }
    [IO.File]::Move($temporaryStatePath, $shareStatePath)
  } finally {
    if (Test-Path -LiteralPath $temporaryStatePath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryStatePath -Force
    }
  }

  $basicAuthentication = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${Username}:${Password}")
  )
  Write-Host "Waiting up to one minute for the authenticated HTTPS address..."
  $publicReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    $tunnelProcess.Refresh()
    if ($tunnelProcess.HasExited) { throw "LocalXpose ended before the protected share became reachable." }
    try {
      $publicResponse = Invoke-WebRequest `
        -UseBasicParsing `
        -Uri $publicUrl `
        -Headers @{ Authorization = "Basic $basicAuthentication" } `
        -TimeoutSec 5
      if ($publicResponse.StatusCode -eq 200) {
        $publicReady = $true
        break
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $publicReady) { throw "The LocalXpose process started, but the protected HTTPS URL did not become reachable." }

  Write-Host ""
  Write-Host "Protected ClearLedger share"
  Write-Host "URL: $publicUrl"
  Write-Host "Username: $Username"
  Write-Host "Password: $Password"
  Write-Host "Company locked to: $OrganizationId"
  Write-Warning "Send these details privately to only the named tester. Use fictional beta data."
  Write-Host "Keep this window open. Press Ctrl+C to end remote access."
  Write-Host ""

  while (-not $tunnelProcess.HasExited) {
    Start-Sleep -Seconds 1
    $tunnelProcess.Refresh()
  }
  # Stop-ClearLedgerShare validates and terminates only the recorded child, then
  # removes its state file. A forced Loclx exit is therefore expected when the
  # owner stops the share from another PowerShell window.
  $stoppedExternally = -not (Test-Path -LiteralPath $shareStatePath -PathType Leaf)
  if ($tunnelProcess.ExitCode -ne 0 -and -not $stoppedExternally) {
    throw "LocalXpose ended unexpectedly. Run Stop-ClearLedgerShare.ps1, then Diagnose-ClearLedger.ps1 before trying again."
  }
  if ($stoppedExternally) { Write-Host "The protected share was stopped from another window." }
} finally {
  try {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited -and
        -not (Test-Path -LiteralPath $shareStatePath -PathType Leaf)) {
      Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($shareCleanupNeeded -or (Test-Path -LiteralPath $shareStatePath -PathType Leaf)) {
      & $stopShareScript -Quiet
    }
  } finally {
    foreach ($entry in $previousVariables.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
    }
    Write-Host "Any protected remote access is stopped. The owner's local ClearLedger session remains available."
  }
}
