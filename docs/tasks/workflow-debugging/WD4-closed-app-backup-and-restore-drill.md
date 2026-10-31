# WD4 — Backups while PennyWise is closed, and a full restore drill

**Target tree:** `C:\Users\EmceeHax\Desktop\clearledger-src`
**Lane:** native (`distribution/windows-native/native-operations.cjs`), plus a QA script
**Effort:** M
**Severity:** Medium. One night's backup was lost, and Restore has never been drilled with
documents.
**Depends on:** WD3, which edits the same file.

## Why

When PennyWise is closed, `createBackup` starts the private database itself, through
`databaseSession` (`native-operations.cjs:199-240`). On 2026-09-23T08:00:54Z that failed:

> `FATAL PennyWise backup could not finish: Error: PennyWise could not start its private database. pg_ctl.exe failed: unknown failure …`

"unknown failure" is the fallback text in `run()` (`native-operations.cjs:157-172`). `pg_ctl
start` runs with `stdio: "ignore"` so the server doesn't hold Node's pipes open, which leaves no
stderr to report. It also runs without `-l`, so PostgreSQL writes no server log. The cause can't
be recovered from today's evidence. The launcher's own `pg_ctl start` has the same gap.

The documents part of the archive has never been tested on real archives:

- All 14 archives in `D:\PennyWiseBackups` lack `documents/`, because the owner's `.data` folder
  doesn't exist yet.
- The API writes rendered invoices to `<dataRoot>\.data\documents` and logos to
  `<dataRoot>\.data\logos` (`invoice-render-service.ts:26`, `logo-service.ts:19`, run with
  `cwd = dataRoot`). Backup copies `.data` into `documents/` (`native-operations.cjs:495-497`).
- The manifest always lists `documents/` (`native-operations.cjs:513`), unlike `trial.json?`,
  which is marked optional.
- The launcher also creates `<dataRoot>\files` (`launcher.cjs:41`), which nothing appears to use.

## Hypotheses for 2026-09-23 (test each)

- **H1.** A stale `postmaster.pid` from an unclean stop (WD2 H4) blocked `pg_ctl start`.
- **H2.** PostgreSQL was still running for this data directory on a port that wasn't in
  `runtime-state.json`. `databaseSession` probes only `state.databasePort` and `preferredPort`.
- **H3.** The chosen port was taken between `freeLoopbackPort` and `pg_ctl start`.
- **H4.** Another process, such as antivirus or a sync client, locked files in the data directory.

## Tasks

1. **Make start failures diagnosable** without bringing back the pipe hang.
   - Pass `-l <dataRoot>\logs\postgresql-start.log` to `pg_ctl start`, in both
     `native-operations.cjs` and `launcher.cjs`. Alternatively, redirect output to a file handle,
     as `spawnLogged` does.
   - Put the last 20 lines of that log, redacted, into the thrown error.
   - Test this with the existing `.cmd` fixture pattern.
2. **Reproduce H1–H3** in a temp data root, using the bundled PostgreSQL runtime that
   `ensureBundledPostgresRuntime` resolves. Ask the owner for a binaries path if it can't be
   found, and don't download PostgreSQL.
   - Record what `createBackup` does in each case.
   - Fix the confirmed cases. For example, read `postmaster.pid` (line 1 is the PID, line 4 the
     port), and if that PID is alive, use its port for `pg_dump` instead of starting a second
     server. Check what `pg_ctl` already does by itself with a dead-PID `postmaster.pid` before
     adding code.
   - For H4, document only.
3. **Run a restore drill with documents**, in a disposable profile (see the README's shared
   rule 1):

   1. Create a customer and finalize an invoice with a rendered PDF, and upload a logo, so `.data`
      isn't empty.
   2. Back up with the app closed, then again with it open.
   3. Wipe the profile's database and `.data`, then restore the first archive.
   4. Verify:
      - row counts for the core ledger, invoice and customer tables match;
      - every file hash under `.data` matches;
      - the app reaches Ready and the invoice PDF downloads with the same SHA-256.

   Script it as `distribution/public-beta/qa/Test-PennyWiseRestoreDrill.ps1`, or as a
   `node:test` with real PostgreSQL, whichever reuses more of the existing code.

4. **Optional, only if the launch line says "owner approves real-archive drill":** restore a
   _copy_ of the newest archive from `D:\PennyWiseBackups` into a disposable profile, and report
   only pass or fail, counts and hashes. Never print the archive's data, and delete the profile
   afterwards.
5. **Make the manifest truthful.** Either mark `documents/` optional (`documents/?`), or list it
   only when it's present. Pick the smaller change. Restore must accept archives in both the new
   and the 0.14.0.13 format, so add a test with a synthetic archive in the old format.
6. **Settle `<dataRoot>\files`.** Search `apps/`, `packages/` and `distribution/` for any reader
   or writer. Report what you find, and don't remove the folder in this prompt.

## Constraints

- Follow the README's shared rules. No backups to, or restores from, the live data root or
  `D:\PennyWiseBackups`, except the approved copy in task 4.
- Don't change the archive's checksum scheme or the retention rules.

## Acceptance criteria

- A failing `pg_ctl start` produces an error that contains PostgreSQL's own reason.
- The restore drill passes with a non-empty `.data`, and its evidence (counts and hashes) is in
  the report.
- An archive in the 0.14.0.13 format still restores.
- The native tests, lint and the format check pass.
