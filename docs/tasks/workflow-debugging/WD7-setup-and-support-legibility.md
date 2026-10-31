# WD7 — Setup and support errors that testers can read

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** installer (`distribution/windows-native/Setup.cs`, the build scripts and the SEA
config). Can run beside the native lane, but coordinate with WD5 if `redact()` changes.
**Effort:** S
**Severity:** Low–Medium. When setup fails, neither the tester nor support can see why.
**Depends on:** nothing.

## Why

### Verified evidence

- **The setup log hides the real error.** The first install of 0.14.0.11 on 2026-09-07 failed
  (`%LOCALAPPDATA%\PennyWiseSetup\logs\20260907-161052-20424.log`, 54 KB).
  - The tester saw "PennyWise setup or first launch failed. See the setup log for the exact
    error."
  - The log is almost entirely `#< CLIXML`, PowerShell's serialized output.
  - The real error is buried inside it: "Program 'node.exe' failed to run: Access is denied",
    at script line 35, `& (Join-Path $resources 'node\node.exe') (Join-Path $resources
'provi…`.
  - `Setup.cs:64-71` starts `powershell.exe -EncodedCommand` with stdout and stderr redirected,
    logs every line and throws a generic exception. 0.14.0.12 fixed the underlying failure by
    copying `node.exe` to a staging folder (`Install-BetaPayload.ps1:34-38`), so that fix is out
    of scope.
- **Packaged stack traces expose the build machine.** They contain the build machine's path and
  Windows username, for example
  `C:\Users\EmceeHax\Desktop\clearledger-src\distribution\windows-native\build\launcher.cjs:318:27`
  (`launcher.log` line 5 and others). Every tester's log and Diagnostics bundle carries them, and
  the line numbers point into build output, not source.
- **These distinct FATAL messages appear in `launcher.log`:**
  - "Choose a second drive or a recognized synced folder for backups…" (0.14.0.4 first run)
  - "initdb.exe failed (1): Access is denied." (fixed by H7)
  - "PennyWise PostgreSQL runtime verification data is missing or invalid."
  - "node.exe stopped unexpectedly: exit 4294967295" and "… exit 3221225786"
  - "PennyWise backup could not finish: … pg_ctl.exe failed: unknown failure"

### Hypothesis

Windows PowerShell 5.1 writes its error stream as CLIXML when stderr is redirected and no
`-OutputFormat Text` is given. Verify this before relying on it.

## Tasks

1. **Make setup failures readable.**
   - Reproduce the CLIXML log with a deliberately failing script run through the same
     `ProcessStartInfo` settings. A small C# console harness compiled with the same `csc` the
     build uses is fine.
   - Fix it with `-OutputFormat Text`, or by wrapping the encoded script in
     `try { … } catch { [Console]::Error.WriteLine(($_ | Out-String)); exit 1 }`. Use whichever
     produces plain text, and show it does.
   - Make the final exception carry the first real error line, for example "PennyWise setup
     failed: Program 'node.exe' failed to run: Access is denied. Setup log: <path>."
2. **Strip build paths from bundled stack traces.**
   - Build the launcher bundle so its stack frames name a path-neutral file such as
     `launcher.cjs:LINE`. Use whichever lever the build supports: an esbuild option, staging from
     a neutral directory, or source-map-free renaming. See `sea-config.json`,
     `Build-PennyWiseMsix.ps1` and `Build-PennyWiseInnoSetup.ps1`.
   - Verify by building only the launcher bundle and throwing a test error. If verification needs
     a full installer build, stop and give the owner the command instead.
3. **Strip user paths in Diagnostics.** Make `redact()` map `C:\Users\<name>\` to
   `%USERPROFILE%\`. If WD5 already moved redaction into a shared helper, change it there.
4. **Audit the startup messages.** For each FATAL listed above, show what `startupMessage`
   (`launcher.cjs:65`) tells the user. Report any that fall back to a generic or misleading
   message, and fix only wording that's wrong today.

## Constraints

- Follow the README's shared rules. Don't run any installer, including those in
  `D:\PennyWiseBetaCandidates`. Don't import certificates or install packages.
- Don't change the signing flow, the installer flavour logic (PB4 owns that) or any CI file (QA0
  owns those).

## Acceptance criteria

- A failing PowerShell step produces plain text in the setup log, and the message box shows the
  first real error line.
- A test stack trace from the bundled launcher contains no `C:\Users\…\Desktop\clearledger-src`.
- The `redact()` test covers a `C:\Users\<name>\` path.
- Lint and the format check pass. If `Setup.cs` changed, it compiles with the build's own
  compiler.
