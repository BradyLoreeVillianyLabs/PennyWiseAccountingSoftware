# WD1 — A stale launcher lock blocks Restore and Inno updates, then shuts down the next launch

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** native (`distribution/windows-native/`)
**Effort:** S
**Severity:** High. It reproduces on the owner's machine today, and Restore is the recovery path.
**Depends on:** nothing. WD2 fixes why the lock goes stale; this prompt makes every lock reader
survive a stale lock.

## Why

A launcher that ends without running its `exit` handler leaves `launcher.lock` behind. Four
places decide from that file whether PennyWise is running:

| Reader                                                         | Check                     | Result with a stale lock                                                                                                                           |
| -------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restore: `requestRunningLauncherExit`, `launcher.cjs:374`      | file exists               | Writes `shutdown-request.json`, waits 60 s, then throws "PennyWise is still running. Close PennyWise, wait one minute, then choose Restore again." |
| Inno update: `StopRunningPennyWise`, `PennyWiseBeta.iss:59-80` | file exists               | Writes the request, waits 90 s, then aborts with "PennyWise did not close safely for this update."                                                 |
| MSIX update: `Install-BetaPayload.ps1:22-30`                   | PID alive (`Get-Process`) | Works, but a reused PID blocks the update for 90 s.                                                                                                |
| Launch: `main`, `launcher.cjs:656-679`                         | `process.kill(pid, 0)`    | Works, but a reused PID shows "already running".                                                                                                   |

The two failing paths also leave `shutdown-request.json` behind. The next normal launch reaches
Ready, then the 500 ms loop at `launcher.cjs:765-771` finds the file, logs "A restore requested a
controlled launcher shutdown." and closes PennyWise. That log line says "restore" whatever the
file's `reason` actually is (`setup-update`, `inno-update` or `restore`).

## Verified evidence (2026-10-18)

- `%LOCALAPPDATA%\PennyWiseAccounting\launcher.lock` holds PID 5732 and is dated 2026-10-12. No
  process 5732 exists, and nothing listens on 32100, 32101 or 54329.
- The last start in `launcher.log` is 2026-10-12T18:06:33Z, Ready at 18:07:12Z. No stop, FATAL
  or shutdown line follows it.
- `launcher.log` line 135, at 2026-09-07T16:27:37Z, reads "A restore requested a controlled
  launcher shutdown." It was written during the 0.14.0.13 setup run
  (`%LOCALAPPDATA%\PennyWiseSetup\logs\20260907-162718-26032.log`), not by a restore.

## Tasks

1. **Reproduce first.**
   - The launcher runs at module load: it builds the data root from `LOCALAPPDATA` and calls
     `main()`. To make the lock logic testable, move the lock and shutdown-request logic into a
     small module (for example `launcher-lock.cjs`) that `launcher.cjs` requires. Keep the
     extraction minimal, and include the new module in the SEA and MSIX staging steps in
     `Build-PennyWiseMsix.ps1` and `Build-PennyWiseInnoSetup.ps1`.
   - With a temp data root and a lock holding a PID that isn't running, show two failures:
     - the restore exit request throws after its wait (inject a short deadline);
     - a leftover `shutdown-request.json` ends a fresh launcher session.
2. **Apply one liveness rule everywhere.**
   - A lock is live only if its PID exists _and_ that process is the PennyWise launcher image
     _and_ it started no later than the lock was written.
   - Write the lock as JSON: `{ "schema": 1, "pid", "startedAt", "image" }`. Keep reading the
     old plain-PID format.
   - Apply the rule in launcher `main`, in restore, in `Install-BetaPayload.ps1` and in
     `PennyWiseBeta.iss`. For Inno, you can call
     `tasklist.exe /FI "PID eq <n>" /FO CSV /NH` and compare the image name. All four must give
     the same answer.
   - When a reader removes a stale lock, it logs "Removed a stale launcher lock left by PID <n>."
3. **Address shutdown requests to one launcher.**
   - Write the request as `{ "schema": 1, "reason", "requestedAt", "targetPid" }`.
   - A launcher honours a request only when `targetPid` is its own PID, or when the request has
     no `targetPid` (installers already shipped, .11 to .13) and its file time is later than the
     launcher's own start. Otherwise it deletes the request at startup and logs why.
   - The log line names the real reason, for example "Setup requested a controlled shutdown for
     an update."
4. **Don't wait when nothing is running.** If no live launcher exists, Restore continues
   immediately and writes no request.
5. **Update the docs.** Record the lock and shutdown-request contract in
   `distribution/windows-native/README.md`. Update `docs/BACKUP_AND_RECOVERY.md` if any restore
   wording changes.

## Constraints

- Follow the README's shared rules. Don't touch the live `launcher.lock`.
- Keep the single-instance guarantee. A genuinely running launcher must still block a second one.
- Change the Inno and MSIX update flows only in their lock check and request format.

## Acceptance criteria

- New tests fail on the current code and pass after the fix. They cover:
  - a stale lock plus Restore;
  - a stale lock plus the launch check;
  - a leftover request ignored at startup;
  - a live launcher still honouring a request addressed to it;
  - an old-format lock and an old-format request.
- The PowerShell and Inno checks are tested with a fake data root where possible. Anything only
  checked by hand is listed in the report.
- `node --test` on the native tests, `corepack pnpm lint` and `corepack pnpm format:check` all
  pass.

## Owner actions to include in the report

- **Clear the stale lock now:** start PennyWise once from Start. The current launcher already
  removes a lock whose PID is dead (`launcher.cjs:661-676`). Do this before any Restore or Inno
  update on this machine.

## Out of scope

- Why the launcher ended without logging (WD2).
