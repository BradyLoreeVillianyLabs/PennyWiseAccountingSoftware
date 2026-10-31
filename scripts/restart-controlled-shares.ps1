[CmdletBinding()]
param(
    [switch] $FunctionsOnly,

    # Validate target discovery and restart inputs without touching a process.
    [switch] $ValidateOnly,

    # When specified, validate the complete controlled-share layout but restart
    # only this reserved share. This keeps unrelated reviewer tunnels stable.
    [string] $Share
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class ClearLedgerProcessEnvironment
{
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION
    {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr Reserved3;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(
        IntPtr process,
        IntPtr address,
        byte[] buffer,
        int size,
        out IntPtr bytesRead);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr process,
        int processInformationClass,
        ref PROCESS_BASIC_INFORMATION processInformation,
        int processInformationLength,
        out int returnLength);

    private static IntPtr ReadPointer(IntPtr process, IntPtr address)
    {
        byte[] buffer = new byte[IntPtr.Size];
        IntPtr bytesRead;
        if (!ReadProcessMemory(process, address, buffer, buffer.Length, out bytesRead) ||
            bytesRead.ToInt64() != buffer.Length)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not read process pointer.");
        }

        return IntPtr.Size == 8
            ? new IntPtr(BitConverter.ToInt64(buffer, 0))
            : new IntPtr(BitConverter.ToInt32(buffer, 0));
    }

    public static string[] Read(int processId)
    {
        const uint access = 0x0400 | 0x0010;
        IntPtr process = OpenProcess(access, false, processId);
        if (process == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not open launcher process.");
        }

        try
        {
            var information = new PROCESS_BASIC_INFORMATION();
            int returnLength;
            int status = NtQueryInformationProcess(
                process,
                0,
                ref information,
                Marshal.SizeOf(information),
                out returnLength);
            if (status != 0)
            {
                throw new InvalidOperationException("Could not query launcher process.");
            }

            IntPtr parameters = ReadPointer(
                process,
                IntPtr.Add(information.PebBaseAddress, IntPtr.Size == 8 ? 0x20 : 0x10));
            IntPtr environment = ReadPointer(
                process,
                IntPtr.Add(parameters, IntPtr.Size == 8 ? 0x80 : 0x48));

            var bytes = new List<byte>();
            const int chunkSize = 4096;
            const int maximum = 1024 * 1024;
            int terminator = -1;

            for (int offset = 0; offset < maximum && terminator < 0; offset += chunkSize)
            {
                byte[] chunk = new byte[chunkSize];
                IntPtr bytesRead;
                if (!ReadProcessMemory(
                        process,
                        IntPtr.Add(environment, offset),
                        chunk,
                        chunk.Length,
                        out bytesRead))
                {
                    break;
                }

                int count = (int)bytesRead.ToInt64();
                for (int index = 0; index < count; index++)
                {
                    bytes.Add(chunk[index]);
                }

                int scanStart = Math.Max(0, bytes.Count - count - 2);
                for (int index = scanStart; index + 3 < bytes.Count; index += 2)
                {
                    if (bytes[index] == 0 &&
                        bytes[index + 1] == 0 &&
                        bytes[index + 2] == 0 &&
                        bytes[index + 3] == 0)
                    {
                        terminator = index;
                        break;
                    }
                }

                if (count < chunkSize)
                {
                    break;
                }
            }

            if (terminator < 0)
            {
                throw new InvalidOperationException("Environment terminator was not found.");
            }

            string block = Encoding.Unicode.GetString(bytes.ToArray(), 0, terminator);
            return block.Split(
                new[] { '\0' },
                StringSplitOptions.RemoveEmptyEntries);
        }
        finally
        {
            CloseHandle(process);
        }
    }
}
"@

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$expectedShares = [ordered]@{
    clearledgerpreview = @{
        WebPort = 3100
        ApiPort = 3101
        Email = "albertatreeplanting@gmail.com"
        Name = "Jesse Romo"
        Username = "jesse"
    }
    clearledgeramanda = @{
        WebPort = 3200
        ApiPort = 3201
        Email = "amanda@clearledger.test"
        Name = "Amanda"
        Username = "amanda"
    }
    clearledgercindi = @{
        WebPort = 3300
        ApiPort = 3301
        Email = "cindi@clearledger.test"
        Name = "Cindi"
        Username = "cindi"
    }
    clearledgerbrady = @{
        WebPort = 3400
        ApiPort = 3401
        Email = "brady@clearledger.test"
        Name = "Brady"
        Username = "brady"
    }
}

if (-not [string]::IsNullOrWhiteSpace($Share) -and -not $expectedShares.Contains($Share)) {
    throw "Unknown controlled share '$Share'. No process was stopped."
}

[string[]] $targetSubdomains = @(
    if ([string]::IsNullOrWhiteSpace($Share)) {
        $expectedShares.Keys | ForEach-Object { [string] $_ }
    }
    else {
        [string] $Share
    }
)

function Get-LauncherArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string] $CommandLine,

        [Parameter(Mandatory = $true)]
        [string] $Name
    )

    $pattern = '(?:^|\s)--' + [regex]::Escape($Name) + '\s+(?:"(?<quoted>[^"]*)"|(?<plain>\S+))'
    $match = [regex]::Match($CommandLine, $pattern)
    if (-not $match.Success) {
        throw "Required launcher argument --$Name is missing."
    }

    if ($match.Groups["quoted"].Success) {
        return $match.Groups["quoted"].Value
    }

    return $match.Groups["plain"].Value
}

function Wait-ForPortsToClose {
    param(
        [Parameter(Mandatory = $true)]
        [int[]] $Ports,

        [int] $TimeoutSeconds = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $listeners = @(
            Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
                Where-Object { $_.LocalPort -in $Ports }
        )
        if ($listeners.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    throw "Validated share ports did not close within $TimeoutSeconds seconds."
}

function Stop-ValidatedSharePortOwners {
    param(
        [Parameter(Mandatory = $true)]
        [int] $WebPort,

        [Parameter(Mandatory = $true)]
        [int] $ApiPort
    )

    # Windows can occasionally leave a Node child behind after the launcher
    # tree exits. Only reclaim a process if it is the expected ClearLedger
    # server for one of the already-validated, reserved ports.
    $listeners = @(
        Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalPort -in @($WebPort, $ApiPort) }
    )
    foreach ($listener in $listeners) {
        $owner = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $($listener.OwningProcess)"
        if (-not $owner) {
            throw "A validated share port owner could not be inspected. No replacement launcher was started."
        }

        $expectedServerPattern = if ($listener.LocalPort -eq $ApiPort) {
            'apps/api/src/index\.ts'
        }
        else {
            'apps/web/serve\.mjs'
        }
        if (
            $owner.Name -ne "node.exe" -or
            [string]::IsNullOrWhiteSpace($owner.CommandLine) -or
            $owner.CommandLine -notmatch $expectedServerPattern
        ) {
            throw (
                "A non-ClearLedger process owns a validated share port. " +
                "No replacement launcher was started."
            )
        }

        & taskkill.exe /PID $listener.OwningProcess /T /F 1>$null 2>$null
    }
}

function Wait-ForLocalShare {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process] $Launcher,

        [Parameter(Mandatory = $true)]
        [int] $WebPort,

        [Parameter(Mandatory = $true)]
        [int] $ApiPort,

        [Parameter(Mandatory = $true)]
        [string] $Subdomain,

        [int] $TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $apiReady = $false
    $webReady = $false
    do {
        if (-not $apiReady) {
            try {
                $response = Invoke-WebRequest `
                    -Uri "http://127.0.0.1:$ApiPort/health" `
                    -UseBasicParsing `
                    -TimeoutSec 3
                $apiReady = $response.StatusCode -eq 200
            }
            catch {
                $apiReady = $false
            }
        }

        if (-not $webReady) {
            try {
                $response = Invoke-WebRequest `
                    -Uri "http://127.0.0.1:$WebPort/" `
                    -UseBasicParsing `
                    -TimeoutSec 3
                $webReady = $response.StatusCode -eq 200
            }
            catch {
                $webReady = $false
            }
        }

        if ($apiReady -and $webReady) {
            return
        }
        if ($Launcher.HasExited) {
            throw "$Subdomain launcher exited during startup."
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "$Subdomain did not become locally healthy within $TimeoutSeconds seconds."
}

function Wait-ForPublicShare {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process] $Launcher,

        [Parameter(Mandatory = $true)]
        [string] $Subdomain,

        [Parameter(Mandatory = $true)]
        [string] $Username,

        [Parameter(Mandatory = $true)]
        [string] $Password,

        [int] $TimeoutSeconds = 45
    )

    $credentialBytes = [Text.Encoding]::UTF8.GetBytes("${Username}:${Password}")
    $token = [Convert]::ToBase64String($credentialBytes)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest `
                -Uri "https://$Subdomain.loclx.io/" `
                -Headers @{ Authorization = "Basic $token" } `
                -UseBasicParsing `
                -TimeoutSec 8
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            # The reserved tunnel can take a few seconds to re-register.
        }

        if ($Launcher.HasExited) {
            throw "$Subdomain launcher exited before its public tunnel became ready."
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    throw "$Subdomain is locally healthy, but its public tunnel did not become ready."
}

if ($FunctionsOnly) {
    return
}

$launchers = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "node.exe" -and
            $_.CommandLine -match 'scripts/start-loclx-share\.mjs'
        }
)

if (@($launchers).Count -ne $expectedShares.Count) {
    throw (
        "Expected exactly $($expectedShares.Count) ClearLedger share launchers; " +
        "found $($launchers.Count). No process was stopped."
    )
}

$seenSubdomains = @{}
$snapshots = @(
foreach ($launcher in $launchers) {
    $commandLine = $launcher.CommandLine
    $subdomain = Get-LauncherArgument -CommandLine $commandLine -Name "subdomain"
    if (-not $expectedShares.Contains($subdomain)) {
        throw "Unexpected ClearLedger share '$subdomain'. No process was stopped."
    }

    $webPort = [int](Get-LauncherArgument -CommandLine $commandLine -Name "web-port")
    $apiPort = [int](Get-LauncherArgument -CommandLine $commandLine -Name "api-port")
    if (
        $webPort -ne $expectedShares[$subdomain].WebPort -or
        $apiPort -ne $expectedShares[$subdomain].ApiPort
    ) {
        throw "Unexpected ports for $subdomain. No process was stopped."
    }

    if ($seenSubdomains.ContainsKey($subdomain)) {
        throw "Duplicate ClearLedger share '$subdomain'. No process was stopped."
    }
    $seenSubdomains[$subdomain] = $true

    if ($subdomain -notin $targetSubdomains) {
        continue
    }

    $executableMatch = [regex]::Match(
        $commandLine,
        '^\s*"(?<executable>[^"]+)"\s+(?<arguments>.+)$'
    )
    if (-not $executableMatch.Success) {
        throw "Could not safely parse the $subdomain launcher. No process was stopped."
    }

    $environment = @{}
    foreach (
        $entry in [ClearLedgerProcessEnvironment]::Read([int]$launcher.ProcessId)
    ) {
        $separator = $entry.IndexOf('=')
        if ($separator -gt 0) {
            $environment[$entry.Substring(0, $separator)] =
                $entry.Substring($separator + 1)
        }
    }

    $secret = [string]$environment["CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET"]
    $databaseUrl = [string]$environment["DATABASE_URL"]
    if ($secret.Length -lt 32 -or [string]::IsNullOrWhiteSpace($databaseUrl)) {
        throw (
            "Could not preserve the required environment for $subdomain. " +
            "No process was stopped."
        )
    }

    [pscustomobject]@{
        OldPid = [int]$launcher.ProcessId
        CommandLine = $commandLine
        Executable = $executableMatch.Groups["executable"].Value
        Arguments = $executableMatch.Groups["arguments"].Value
        Subdomain = $subdomain
        WebPort = $webPort
        ApiPort = $apiPort
        Email = (Get-LauncherArgument -CommandLine $commandLine -Name "email")
        Name = (Get-LauncherArgument -CommandLine $commandLine -Name "name")
        Organization = (Get-LauncherArgument -CommandLine $commandLine -Name "organization")
        Username = (Get-LauncherArgument -CommandLine $commandLine -Name "username")
        Password = (Get-LauncherArgument -CommandLine $commandLine -Name "password")
        DatabaseUrl = $databaseUrl
        Secret = $secret
        Path = [string]$environment["Path"]
    }
}
)

if ($seenSubdomains.Count -ne $expectedShares.Count) {
    throw "The controlled-share layout was incomplete. No process was stopped."
}

if (@($snapshots).Count -ne $targetSubdomains.Count) {
    throw "The requested controlled share was not found exactly once. No process was stopped."
}

if ($ValidateOnly) {
    $snapshots |
        Select-Object Subdomain, WebPort, ApiPort |
        Format-Table -AutoSize
    return
}

$results = foreach ($snapshot in ($snapshots | Sort-Object WebPort)) {
    $current = Get-CimInstance Win32_Process `
        -Filter "ProcessId = $($snapshot.OldPid)"
    if (-not $current -or $current.CommandLine -ne $snapshot.CommandLine) {
        throw (
            "The $($snapshot.Subdomain) launcher changed during validation. " +
            "The restart stopped safely."
        )
    }

    & taskkill.exe /PID $snapshot.OldPid /T /F 1>$null 2>$null
    Stop-ValidatedSharePortOwners `
        -WebPort $snapshot.WebPort `
        -ApiPort $snapshot.ApiPort
    Wait-ForPortsToClose -Ports @($snapshot.WebPort, $snapshot.ApiPort)

    $env:DATABASE_URL = $snapshot.DatabaseUrl
    $env:CONNECTOR_CREDENTIAL_ENCRYPTION_SECRET = $snapshot.Secret
    if (-not [string]::IsNullOrWhiteSpace($snapshot.Path)) {
        $env:Path = $snapshot.Path
    }

    $errorLog = Join-Path $env:TEMP "$($snapshot.Subdomain)-share-errors.log"
    $startArguments = @{
        FilePath = $snapshot.Executable
        ArgumentList = $snapshot.Arguments
        WorkingDirectory = $repository
        WindowStyle = "Hidden"
        RedirectStandardOutput = "NUL"
        RedirectStandardError = $errorLog
        PassThru = $true
    }
    $newLauncher = Start-Process @startArguments

    Wait-ForLocalShare `
        -Launcher $newLauncher `
        -WebPort $snapshot.WebPort `
        -ApiPort $snapshot.ApiPort `
        -Subdomain $snapshot.Subdomain

    $membershipHeaders = @{
        "x-clearledger-user-email" = $snapshot.Email
        "x-clearledger-user-name" = $snapshot.Name
    }
    $membership = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$($snapshot.ApiPort)/v1/organizations" `
        -Headers $membershipHeaders `
        -TimeoutSec 10
    if (-not (
        $membership.organizations |
            Where-Object { $_.organizationId -eq $snapshot.Organization }
    )) {
        throw (
            "$($snapshot.Subdomain) restarted, but expected organization " +
            "access was not present."
        )
    }

    Wait-ForPublicShare `
        -Launcher $newLauncher `
        -Subdomain $snapshot.Subdomain `
        -Username $snapshot.Username `
        -Password $snapshot.Password

    [pscustomobject]@{
        Share = $snapshot.Subdomain
        OldPid = $snapshot.OldPid
        NewPid = $newLauncher.Id
        Api = "healthy"
        Web = "healthy"
        Organization = "confirmed"
        Public = "HTTP 200"
    }
}

$quickBooksTunnel = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -like "loclx*" -and
        $_.CommandLine -match 'woobridge\.loclx\.io'
    }

$results | Format-Table -AutoSize
[pscustomobject]@{
    QBWooBridgeTunnel = if ($quickBooksTunnel) {
        "untouched and running"
    }
    else {
        "not found"
    }
    QBWooBridgePid = ($quickBooksTunnel.ProcessId -join ',')
} | Format-List
