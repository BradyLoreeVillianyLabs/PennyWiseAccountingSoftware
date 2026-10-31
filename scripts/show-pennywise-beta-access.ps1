[CmdletBinding()]
param(
    [switch] $RevealPasswords
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# This wrapper deliberately delegates to the current supervisor utility rather
# than reading the encrypted store itself. The active utility owns the JSON/EFS
# format, gives the current URL and per-tester username, and never places a
# password on a process command line.
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$accessScript = Join-Path $repositoryRoot "scripts\pennywise-beta-access.mjs"

if (-not (Test-Path -LiteralPath $accessScript -PathType Leaf)) {
    throw "The PennyWise beta access utility is missing: $accessScript"
}

$arguments = @($accessScript, "access")
if ($RevealPasswords) {
    $arguments += "--reveal"
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
    throw "PennyWise beta access command failed with exit code $LASTEXITCODE."
}
