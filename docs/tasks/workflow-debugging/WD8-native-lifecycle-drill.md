# WD8 — End-to-end native lifecycle drill (regression net)

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** QA (`distribution/public-beta/qa/`)
**Effort:** M
**Depends on:** WD1–WD5. Rerun before every beta candidate.

## Why

Each WD1–WD5 defect sits between two steps of the owner's real day: launch, work, close the
window, nightly backup, update, restore. Unit tests cover single functions, but nothing replays
that sequence on a packaged build.

`Test-PennyWiseInstalledFirstRun.ps1` already shows how to isolate a run:

- it points `LOCALAPPDATA` at `%LOCALAPPDATA%\PennyWiseQA\first-run-<guid>`;
- it pre-seeds `backup-config.json` so the owner's real nightly task is never touched;
- on 2026-09-07 it proved first-run health for 0.14.0.12: API 200, web 200, 112 migrations.

## Tasks

1. **Add the drill script.** Create `distribution/public-beta/qa/Test-PennyWiseLifecycleDrill.ps1`
   on the same isolation, plus WD3's isolated-profile marker if WD3 added one.

   - Each step records pass or fail, its timing and its evidence in `evidence.json` in the QA
     root.
   - The script stops at the first failure and leaves everything in place for inspection.

   The steps:

   1. **First run** reaches Ready: API `/health` returns 200 and the web root returns 200.
   2. **Seed** a customer, a finalized invoice with a rendered PDF and a logo, using
      `scripts/seed-full-demo-company.mjs` if it can target the run, otherwise the API. Record
      the PDF's SHA-256.
   3. **Close the console window** by posting `WM_CLOSE` to the launcher's console window. Assert
      that no lock, no `postmaster.pid` and no QA-owned `node.exe` or `postgres.exe` remain, and
      that the log has one reasoned line (WD2).
   4. **Stale state:** write a dead-PID `launcher.lock` and an old `shutdown-request.json`, then
      relaunch. PennyWise must reach Ready and still be up 60 s later (WD1).
   5. **Backups:** run `PennyWiseBackup.exe --scheduled` with the app closed, then with it open.
      Expect two verified archives in the QA destination, and `backup-status.json` updated
      both times (WD3 and WD4).
   6. **Restore** the first archive while the app is open. Expect a controlled shutdown, the
      restore, a restart, and a downloaded invoice PDF whose SHA-256 matches step 2 (WD1 and
      WD4).
   7. **Diagnostics:** the bundle contains no value matching the secret patterns and no
      `C:\Users\…\Desktop\clearledger-src` path (WD5 and WD7).
   8. **Task safety:** `Get-ScheduledTask 'PennyWise Accounting Nightly Backup*'` returns the
      same tasks, with the same actions, as before the drill.
   9. **Cleanup:** stop everything the drill started. Keep `evidence.json` and the logs, and
      remove the QA data root only when every step passed.

2. **Choose the build under test.**
   - By default, run against the MSIX package that is already installed, and record its version.
   - If the installed version is older than the WD fixes, stop and tell the owner which candidate
     to install. Don't install it yourself.
3. **Document the drill** in `distribution/public-beta/qa/README.md` (create it if missing):
   prerequisites, the command, how to read `evidence.json`, and what each step protects against.
   Link it from `docs/tasks/workflow-debugging/README.md`.

## Constraints

- Follow the README's shared rules. The drill must never read or write the real data root, its
  scheduled task, or `D:\PennyWiseBackups`. Step 8 proves it.
- Use a test activation file the owner provides. Never use slot files from
  `%LOCALAPPDATA%\PennyWiseBetaIssuer`.
- Stop and kill only processes the drill started, tracked by PID.

## Acceptance criteria

- With the WD1–WD5 fixes installed, all steps pass.
- On 0.14.0.13, expect steps 3, 4 and 5 to fail. Record that run's actual results as the
  baseline.
- `evidence.json` is enough on its own for an owner to see what passed and what failed.
