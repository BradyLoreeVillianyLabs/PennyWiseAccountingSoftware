# The Windows beta package supports both Docker Compose v2 (`docker compose`)
# and Docker Desktop's standalone compatibility executable (`docker-compose.exe`).
# Callers may retain a leading `compose` argument for the v2 form; this helper
# normalizes it for the executable that is actually installed.
function Get-ClearLedgerComposeExecutable {
  if (Get-Command "docker-compose.exe" -ErrorAction SilentlyContinue) {
    return "docker-compose.exe"
  }
  if (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
    return "docker-compose"
  }
  if (Get-Command "docker" -ErrorAction SilentlyContinue) {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) { return "docker" }
  }
  throw "Docker Compose is required. Install Docker Desktop with Compose support and try again."
}

function Invoke-ClearLedgerCompose {
  # Use the automatic `$args` collection rather than a declared parameter so
  # Compose flags such as `-d` are passed literally instead of being consumed
  # as PowerShell's common `-Debug` shorthand.
  $Arguments = @($args)
  $executable = Get-ClearLedgerComposeExecutable
  $normalizedArguments = @($Arguments)
  if ($executable -eq "docker-compose.exe" -or $executable -eq "docker-compose") {
    if ($normalizedArguments.Count -gt 0 -and $normalizedArguments[0] -eq "compose") {
      $normalizedArguments = @($normalizedArguments | Select-Object -Skip 1)
    }
  } elseif ($normalizedArguments.Count -eq 0 -or $normalizedArguments[0] -ne "compose") {
    $normalizedArguments = @("compose") + $normalizedArguments
  }
  # Windows PowerShell promotes native stderr (including benign Compose
  # messages such as "No stopped containers") to a terminating error when the
  # caller uses `$ErrorActionPreference = "Stop"`. Merge the stream here so
  # callers can consistently decide from `$LASTEXITCODE` instead.
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    # Windows PowerShell materializes native stderr as ErrorRecord objects. Keep
    # those progress lines out of the caller's error stream (where a strict
    # $ErrorActionPreference can mistake normal Compose status for failure), while
    # preserving stdout for commands such as `ps -q` and retaining the real exit code.
    $composeOutput = @(& $executable @normalizedArguments 2>&1)
    foreach ($entry in $composeOutput) {
      if ($entry -is [System.Management.Automation.ErrorRecord]) {
        Write-Host $entry.ToString()
      } else {
        Write-Output $entry
      }
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}
