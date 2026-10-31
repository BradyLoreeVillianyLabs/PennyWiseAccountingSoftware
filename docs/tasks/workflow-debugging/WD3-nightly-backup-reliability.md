# WD3 — Nightly backups: silent gaps, a stale task after upgrades, and no health signal

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** native (`distribution/windows-native/`)
**Effort:** M
**Severity:** High. Backups are the only protection for the owner's books.
**Depends on:** WD2, which edits the same files.

## Why

Between 2026-09-07 and 2026-10-18, `launcher.log` shows a verified backup on 39 of 42 nights. The
backup runs at 02:00 local, which is 08:00Z. The other three nights:

| Night      | launcher.log                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-09-10 | no entry                                                                                     |
| 2026-09-16 | no entry                                                                                     |
| 2026-09-23 | `FATAL … could not start its private database. pg_ctl.exe failed: unknown failure` (see WD4) |

Nothing in PennyWise told the owner about any of them. Task Scheduler doesn't show the gap
either: it reports `LastTaskResult 0` for 2026-10-18 and `NumberOfMissedRuns 0`.

## Verified evidence (2026-10-18)

- **The installed wrapper is stale.** `operations\Run-NightlyBackup.cmd`, written 2026-09-06,
  runs `"%PW_PACKAGE%\PennyWiseBackup.exe" --scheduled` directly.
  - The current `taskWrapperContents` (`native-operations.cjs:720-744`) writes a different MSIX
    wrapper, which starts Backup through `application-activation.cs`.
  - `launcher.cjs:33-35` explains why: Windows blocks a scheduled task from launching a binary
    under the WindowsApps package path.
  - The launcher writes the wrapper and registers the task only when `backup-config.json` has no
    destination (`launcher.cjs:691`). So the 0.14.0.12 and 0.14.0.13 updates never refreshed it.
- **The task name has drifted.** The registered task is `PennyWise Accounting Nightly Backup`.
  The current source names it `PennyWise Accounting Nightly Backup - <username>`
  (`native-operations.cjs:10`), and Support Diagnostics reports that new name. A naive refresh
  would create a second nightly task beside the old one.
- **The wrapper can exit silently.** `if not defined PW_PACKAGE exit /b 20`, and any failure
  before `PennyWiseBackup.exe` starts, writes nothing to any log.
- **The destination warning is shown once and the rejection wording overstates the policy.**
  - `backup-config.json` says `"kind": "separate-volume-same-disk"`: all 14 retained backups sit
    on the same physical disk as the books.
  - The launcher warns about this only once, at configure time (`launcher.cjs:364-371`).
  - The same-volume rejection message (`native-operations.cjs:338`) says PennyWise "will not keep
    the only backup on the same disk", yet the policy accepts same-disk volumes.
- **The QA drill relies on the current behaviour.** `Test-PennyWiseInstalledFirstRun.ps1:14-16`
  pre-seeds `backup-config.json` so an isolated profile never registers the owner's real task.
  Any "refresh on launch" change must keep that protection.

## Tasks

1. **Explain the missing nights, read-only.**
   - Query `Get-WinEvent` on `Microsoft-Windows-TaskScheduler/Operational` for both task names
     around 2026-09-10 and 2026-09-16. Say if that log is disabled or has rolled over.
   - Check the System log for sleep, shutdown and power events on those nights (for example
     Kernel-Power 42, 107 and 41, and EventLog 6005 and 6006).
   - Conclude one of:
     - the task didn't fire;
     - the wrapper exited early;
     - Backup crashed before logging;
     - the machine was off or asleep;
     - unknown, because the evidence is gone.
2. **Refresh scheduling when the app launches.**
   - When a destination is configured, compare the wrapper, the task XML and the registered task
     name with what the current code would produce for this install type.
   - If they differ, rewrite them and re-register through the existing `registerTask` seam, then
     log "Nightly backup task updated for <version>."
   - Migrate the legacy task name so exactly one nightly task remains, and log the migration.
   - If the destination no longer validates, warn and log, keep the old task, and still start
     PennyWise.
   - **Guard:** never register or delete a task from an isolated profile, meaning a data root
     that isn't the signed-in user's real `%LOCALAPPDATA%\PennyWiseAccounting`. Design an
     explicit signal, such as a `qa-profile.json` marker written by the QA scripts, and test it.
3. **Make wrapper failures visible.**
   - Every exit path in the wrapper appends one timestamped line with its exit code to
     `logs\backup-task.log`.
   - The launcher reports new failure lines from that log at its next start.
   - Keep the wrapper ASCII and quoting-safe.
4. **Add a backup health signal.**
   - After every attempt, write `backup-status.json` with `schemaVersion`, `lastAttemptAt`,
     `lastResult`, `lastVerifiedAt`, `lastVerifiedArchive` and `destinationKind`.
   - At start, the launcher logs and shows a warning when `lastVerifiedAt` is older than 36 h,
     or when the destination kind is `separate-volume-same-disk` or `local-recovery-same-disk`.
     Show the same-disk warning at most once per seven days.
   - Search for an existing backup or Books Health surface in `apps/api` and `apps/web`. If one
     exists, feed it the status. Don't build new UI in this prompt.
5. **Correct the rejection wording** so it matches the policy: the same volume is rejected, and
   the same disk is allowed with a warning. Keep it consistent with the H6 report and
   `docs/BACKUP_AND_RECOVERY.md`.
6. **Add tests** in `native-operations.test.mjs`, injecting `registerTask`. Cover:
   - drift is rewritten and re-registered;
   - no drift means no re-registration;
   - the legacy task name is migrated;
   - an isolated profile never registers;
   - the status file is written on both success and failure;
   - the 36-hour threshold.

## Constraints

- Follow the README's shared rules. Never register, change, run or delete the owner's real task,
  and never back up to `D:\PennyWiseBackups`.
- Keep the retention and pruning behaviour unchanged (retain 14, newest by mtime).

## Acceptance criteria

- The report states, with evidence, what happened on 2026-09-10 and 2026-09-16, or says the
  evidence is gone.
- Tests prove that the first launch after an upgrade refreshes a stale wrapper and task name,
  and leaves exactly one task.
- Tests prove that a failed or missing nightly backup produces a warning at the next launch.
- The native tests, lint and the format check pass.

## Owner actions to include in the report

- After this ships, launch PennyWise once so the wrapper and task are refreshed. Then confirm
  that `Get-ScheduledTask -TaskName 'PennyWise Accounting Nightly Backup*'` lists exactly one
  task.
- Keep at least one verified copy on another physical disk or in OneDrive. The current
  destination doesn't survive a disk failure.
